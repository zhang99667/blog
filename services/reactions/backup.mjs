import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { backup, DatabaseSync } from "node:sqlite"

const SNAPSHOT_VERSION = "1.1.0"
const REQUIRED_TABLES = ["daily_visitors", "reactions", "views", "visitors"]
const SNAPSHOT_PATTERN = /^reactions-(\d{8}T\d{9}Z)(?:-(\d+))?\.sqlite$/
const SNAPSHOT_SIDECAR_PATTERN =
  /^reactions-\d{8}T\d{9}Z(?:-\d+)?\.sqlite(?:\.\d+\.partial)?-(?:journal|shm|wal)$/
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_MAX_AGE_MS = 12 * 60 * 60 * 1000
const DEFAULT_RETENTION_COUNT = 32
const DEFAULT_RETRY_MS = 60 * 1000
const PROCESS_TOKEN = randomUUID()

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return number
}

function snapshotStem(now) {
  return `reactions-${now.toISOString().replace(/[-:.]/g, "")}`
}

async function sha256File(file) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.partial`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.chmod(temporary, 0o600)
  await fs.rename(temporary, file)
}

async function removeSqliteSidecars(databasePath) {
  await Promise.all(
    ["-journal", "-shm", "-wal"].map((suffix) =>
      fs.rm(`${databasePath}${suffix}`, { force: true }),
    ),
  )
}

async function makeStandaloneSnapshot(snapshotPath) {
  let database
  try {
    database = new DatabaseSync(snapshotPath, { timeout: 5_000 })
    const mode = String(pragmaValue(database.prepare("PRAGMA journal_mode = DELETE").get()))
    if (mode.toLowerCase() !== "delete") {
      throw new Error(`Unable to make snapshot standalone; journal mode is ${mode}`)
    }
  } finally {
    database?.close()
    await removeSqliteSidecars(snapshotPath)
  }
}

async function nextSnapshotPaths(backupDir, now) {
  const stem = snapshotStem(now)
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = suffix === 0 ? stem : `${stem}-${suffix}`
    const snapshot = path.join(backupDir, `${candidate}.sqlite`)
    try {
      await fs.access(snapshot)
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          stem: candidate,
          snapshot,
          manifest: path.join(backupDir, `${candidate}.json`),
        }
      }
      throw error
    }
  }
  throw new Error("Unable to allocate a unique backup filename")
}

async function withBackupLock(backupDir, operation) {
  const lockPath = path.join(backupDir, ".backup.lock")
  let lock
  try {
    lock = await fs.open(lockPath, "wx", 0o600)
  } catch (error) {
    if (error.code !== "EEXIST") throw error

    let stale = false
    try {
      const owner = JSON.parse(await fs.readFile(lockPath, "utf8"))
      if (
        owner.hostname !== os.hostname() ||
        (owner.pid === process.pid && owner.token !== PROCESS_TOKEN)
      ) {
        stale = true
      } else {
        try {
          process.kill(owner.pid, 0)
        } catch (processError) {
          if (processError.code === "ESRCH") stale = true
          else throw processError
        }
      }
    } catch (lockError) {
      if (lockError.code === "ENOENT") stale = true
    }
    if (!stale) throw new Error("A reactions backup is already running")

    await fs.rm(lockPath, { force: true })
    lock = await fs.open(lockPath, "wx", 0o600)
  }

  try {
    await lock.writeFile(
      `${JSON.stringify({ hostname: os.hostname(), pid: process.pid, token: PROCESS_TOKEN })}\n`,
    )
    return await operation()
  } finally {
    await lock.close()
    await fs.rm(lockPath, { force: true })
  }
}

function pragmaValue(row) {
  return Object.values(row ?? {})[0]
}

export async function verifySnapshot(snapshotPath) {
  let database
  try {
    database = new DatabaseSync(snapshotPath, { readOnly: true, timeout: 5_000 })
    database.exec("PRAGMA query_only = ON;")

    const integrityRows = database.prepare("PRAGMA integrity_check").all()
    if (
      integrityRows.length !== 1 ||
      String(pragmaValue(integrityRows[0])).toLowerCase() !== "ok"
    ) {
      throw new Error(`SQLite integrity check failed: ${JSON.stringify(integrityRows)}`)
    }

    const foreignKeyRows = database.prepare("PRAGMA foreign_key_check").all()
    if (foreignKeyRows.length > 0) {
      throw new Error(`SQLite foreign key check failed: ${JSON.stringify(foreignKeyRows)}`)
    }

    const journalMode = String(pragmaValue(database.prepare("PRAGMA journal_mode").get()))
    if (journalMode.toLowerCase() !== "delete") {
      throw new Error(`Snapshot is not standalone; journal mode is ${journalMode}`)
    }

    const availableTables = new Set(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map(({ name }) => name),
    )
    const missingTables = REQUIRED_TABLES.filter((table) => !availableTables.has(table))
    if (missingTables.length > 0) {
      throw new Error(`Snapshot is missing required tables: ${missingTables.join(", ")}`)
    }

    const tableRows = Object.fromEntries(
      REQUIRED_TABLES.map((table) => [
        table,
        Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
      ]),
    )
    const stat = await fs.stat(snapshotPath)
    return {
      bytes: stat.size,
      sha256: await sha256File(snapshotPath),
      pageCount: Number(pragmaValue(database.prepare("PRAGMA page_count").get())),
      pageSize: Number(pragmaValue(database.prepare("PRAGMA page_size").get())),
      tableRows,
      integrity: "ok",
      foreignKeys: "ok",
      journalMode: "delete",
    }
  } finally {
    database?.close()
  }
}

async function completeBackupSets(backupDir) {
  const names = await fs.readdir(backupDir)
  const snapshots = names
    .filter((name) => SNAPSHOT_PATTERN.test(name))
    .sort((first, second) => {
      const firstMatch = first.match(SNAPSHOT_PATTERN)
      const secondMatch = second.match(SNAPSHOT_PATTERN)
      return (
        secondMatch[1].localeCompare(firstMatch[1]) ||
        Number(secondMatch[2] ?? 0) - Number(firstMatch[2] ?? 0)
      )
    })
  const sets = []
  for (const snapshot of snapshots) {
    const manifest = snapshot.replace(/\.sqlite$/, ".json")
    if (names.includes(manifest)) {
      sets.push({
        snapshot: path.join(backupDir, snapshot),
        manifest: path.join(backupDir, manifest),
        snapshotName: snapshot,
        manifestName: manifest,
      })
    }
  }
  return sets
}

export async function pruneBackups(backupDir, retentionCount = DEFAULT_RETENTION_COUNT) {
  const keep = positiveInteger(retentionCount, DEFAULT_RETENTION_COUNT, "retentionCount")
  const names = await fs.readdir(backupDir)
  const complete = await completeBackupSets(backupDir)
  const completeNames = new Set(
    complete.flatMap(({ snapshotName, manifestName }) => [snapshotName, manifestName]),
  )
  const removed = []

  for (const set of complete.slice(keep)) {
    await fs.rm(set.snapshot, { force: true })
    await fs.rm(set.manifest, { force: true })
    removed.push(set.snapshotName)
  }

  for (const name of names) {
    const isPartial = name.endsWith(".partial")
    const isSidecar = SNAPSHOT_SIDECAR_PATTERN.test(name)
    const isOrphanSnapshot = SNAPSHOT_PATTERN.test(name) && !completeNames.has(name)
    const snapshotName = name.replace(/\.json$/, ".sqlite")
    const isOrphanManifest =
      name.endsWith(".json") && SNAPSHOT_PATTERN.test(snapshotName) && !completeNames.has(name)
    if (isPartial || isSidecar || isOrphanSnapshot || isOrphanManifest) {
      await fs.rm(path.join(backupDir, name), { force: true })
      removed.push(name)
    }
  }

  return removed.sort()
}

export async function createBackup({
  databasePath,
  backupDir,
  now = new Date(),
  retentionCount = DEFAULT_RETENTION_COUNT,
} = {}) {
  if (!databasePath) throw new Error("databasePath is required")
  if (!backupDir) throw new Error("backupDir is required")
  const createdAt = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(createdAt.getTime())) throw new Error("now must be a valid date")

  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 })
  await fs.chmod(backupDir, 0o700)

  return withBackupLock(backupDir, async () => {
    await pruneBackups(backupDir, retentionCount)
    const paths = await nextSnapshotPaths(backupDir, createdAt)
    const temporarySnapshot = `${paths.snapshot}.${process.pid}.partial`
    const temporaryManifest = `${paths.manifest}.${process.pid}.partial`
    let source

    try {
      source = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 })
      source.exec("PRAGMA query_only = ON;")
      await backup(source, temporarySnapshot, { rate: 100 })
      source.close()
      source = undefined

      await makeStandaloneSnapshot(temporarySnapshot)
      await fs.chmod(temporarySnapshot, 0o600)
      const verification = await verifySnapshot(temporarySnapshot)
      const manifest = {
        version: SNAPSHOT_VERSION,
        createdAt: createdAt.toISOString(),
        source: path.basename(databasePath),
        snapshot: path.basename(paths.snapshot),
        ...verification,
      }
      await fs.writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
        mode: 0o600,
      })
      await fs.chmod(temporaryManifest, 0o600)
      await fs.rename(temporarySnapshot, paths.snapshot)
      await fs.rename(temporaryManifest, paths.manifest)
      await atomicJson(path.join(backupDir, "latest.json"), manifest)
      await pruneBackups(backupDir, retentionCount)
      return { ...manifest, snapshotPath: paths.snapshot, manifestPath: paths.manifest }
    } catch (error) {
      source?.close()
      await fs.rm(temporarySnapshot, { force: true })
      await fs.rm(temporaryManifest, { force: true })
      await removeSqliteSidecars(temporarySnapshot)
      throw error
    }
  })
}

async function loadLatestManifest(backupDir) {
  const status = JSON.parse(await fs.readFile(path.join(backupDir, "latest.json"), "utf8"))
  if (status.version !== SNAPSHOT_VERSION || !SNAPSHOT_PATTERN.test(status.snapshot ?? "")) {
    throw new Error("Latest reactions backup metadata is invalid")
  }
  return status
}

async function verifyRecordedSnapshot(backupDir, manifest) {
  const snapshotPath = path.join(backupDir, manifest.snapshot)
  const companionPath = snapshotPath.replace(/\.sqlite$/, ".json")
  const companion = JSON.parse(await fs.readFile(companionPath, "utf8"))
  if (JSON.stringify(companion) !== JSON.stringify(manifest)) {
    throw new Error("Latest reactions backup metadata does not match its snapshot manifest")
  }

  const verification = await verifySnapshot(snapshotPath)
  if (verification.sha256 !== manifest.sha256) {
    throw new Error("Latest reactions backup checksum does not match its manifest")
  }
  if (JSON.stringify(verification.tableRows) !== JSON.stringify(manifest.tableRows)) {
    throw new Error("Latest reactions backup row counts do not match its manifest")
  }
  return { ...verification, snapshotPath }
}

export async function latestVerifiedBackup({
  backupDir,
  now = new Date(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const result = await backupHealth({ backupDir, now, maxAgeMs })
  const { snapshotPath: _snapshotPath, ageMs: _ageMs, ...manifest } = result
  return manifest
}

export async function backupHealth({
  backupDir,
  now = new Date(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  if (!backupDir) throw new Error("backupDir is required")
  const checkedAt = now instanceof Date ? now : new Date(now)
  const allowedAge = positiveInteger(maxAgeMs, DEFAULT_MAX_AGE_MS, "maxAgeMs")
  const manifest = await loadLatestManifest(backupDir)
  const ageMs = checkedAt.getTime() - new Date(manifest.createdAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < -5 * 60 * 1000 || ageMs > allowedAge) {
    throw new Error(`Latest reactions backup is stale (${ageMs} ms old)`)
  }

  const verification = await verifyRecordedSnapshot(backupDir, manifest)
  return { ...manifest, ...verification, ageMs }
}

export async function restoreSnapshot({ snapshotPath, destinationPath } = {}) {
  if (!snapshotPath) throw new Error("snapshotPath is required")
  if (!destinationPath) throw new Error("destinationPath is required")
  if (path.resolve(snapshotPath) === path.resolve(destinationPath)) {
    throw new Error("Restore destination must differ from the snapshot")
  }
  try {
    await fs.access(destinationPath)
    throw new Error("Restore destination already exists")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }

  await verifySnapshot(snapshotPath)
  await fs.mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 })
  const temporary = `${destinationPath}.${process.pid}.partial`
  let source
  try {
    source = new DatabaseSync(snapshotPath, { readOnly: true, timeout: 5_000 })
    source.exec("PRAGMA query_only = ON;")
    await backup(source, temporary, { rate: 100 })
    source.close()
    source = undefined
    await makeStandaloneSnapshot(temporary)
    await fs.chmod(temporary, 0o600)
    const verification = await verifySnapshot(temporary)
    await fs.rename(temporary, destinationPath)
    return { ...verification, destinationPath }
  } catch (error) {
    source?.close()
    await fs.rm(temporary, { force: true })
    await removeSqliteSidecars(temporary)
    throw error
  }
}

export async function runRestoreDrill({ backupDir } = {}) {
  const latest = await loadLatestManifest(backupDir)
  await verifyRecordedSnapshot(backupDir, latest)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "markz-reactions-restore-"))
  try {
    const restored = await restoreSnapshot({
      snapshotPath: path.join(backupDir, latest.snapshot),
      destinationPath: path.join(directory, "restored.sqlite"),
    })
    if (JSON.stringify(restored.tableRows) !== JSON.stringify(latest.tableRows)) {
      throw new Error("Restore drill row counts differ from the source snapshot")
    }
    return { snapshot: latest.snapshot, ...restored }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

async function runDaemon(options) {
  let stopping = false
  let wake
  const stop = () => {
    stopping = true
    wake?.()
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)

  while (!stopping) {
    let waitMs = options.intervalMs
    try {
      const result = await createBackup(options)
      console.log(`Created verified reactions backup ${result.snapshot}`)
    } catch (error) {
      console.error("Reactions backup failed", error)
      waitMs = Math.min(options.intervalMs, options.retryMs)
    }
    if (!stopping) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, waitMs)
        wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      wake = undefined
    }
  }
}

async function main() {
  const command = process.argv[2] ?? "once"
  const options = {
    databasePath: process.env.REACTIONS_DB_PATH ?? "/data/reactions.sqlite",
    backupDir: process.env.REACTIONS_BACKUP_DIR ?? "/backups",
    intervalMs: positiveInteger(
      process.env.BACKUP_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
      "BACKUP_INTERVAL_MS",
    ),
    retentionCount: positiveInteger(
      process.env.BACKUP_RETENTION_COUNT,
      DEFAULT_RETENTION_COUNT,
      "BACKUP_RETENTION_COUNT",
    ),
    retryMs: positiveInteger(process.env.BACKUP_RETRY_MS, DEFAULT_RETRY_MS, "BACKUP_RETRY_MS"),
  }

  if (command === "once") {
    const result = await createBackup(options)
    console.log(`Created verified reactions backup ${result.snapshot}`)
    return
  }
  if (command === "daemon") {
    await runDaemon(options)
    return
  }
  if (command === "health") {
    const result = await backupHealth({
      backupDir: options.backupDir,
      maxAgeMs: positiveInteger(
        process.env.BACKUP_MAX_AGE_MS,
        DEFAULT_MAX_AGE_MS,
        "BACKUP_MAX_AGE_MS",
      ),
    })
    console.log(`Reactions backup healthy: ${result.snapshot}, age ${result.ageMs} ms`)
    return
  }
  if (command === "verify") {
    const result = await verifySnapshot(process.argv[3])
    console.log(JSON.stringify(result))
    return
  }
  if (command === "latest-json") {
    const result = await latestVerifiedBackup({
      backupDir: options.backupDir,
      maxAgeMs: positiveInteger(
        process.env.BACKUP_MAX_AGE_MS,
        DEFAULT_MAX_AGE_MS,
        "BACKUP_MAX_AGE_MS",
      ),
    })
    console.log(JSON.stringify(result))
    return
  }
  if (command === "drill") {
    const result = await runRestoreDrill({ backupDir: options.backupDir })
    console.log(`Reactions restore drill passed for ${result.snapshot}`)
    return
  }
  if (command === "restore") {
    const result = await restoreSnapshot({
      snapshotPath: process.argv[3],
      destinationPath: process.argv[4],
    })
    console.log(`Restored verified reactions database to ${result.destinationPath}`)
    return
  }
  throw new Error(`Unknown backup command: ${command}`)
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

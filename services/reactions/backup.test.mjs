import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import {
  backupHealth,
  createBackup,
  latestVerifiedBackup,
  restoreSnapshot,
  runRestoreDrill,
  verifySnapshot,
} from "./backup.mjs"
import { createReactionStore } from "./server.mjs"

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "markz-reactions-backup-test-"))
  const databasePath = path.join(root, "data", "reactions.sqlite")
  const backupDir = path.join(root, "backups")
  const store = createReactionStore(databasePath)
  t.after(async () => {
    store.close()
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, databasePath, backupDir, store }
}

function seed(store, suffix = "1") {
  const visitor = `00000000-0000-4000-8000-00000000000${suffix}`
  store.addVisitor(visitor, "2026-07-14")
  store.addView("blog", `blog/article-${suffix}`, visitor)
  store.addLike("blog", `blog/article-${suffix}`, visitor)
}

test("online backup creates a private, verified snapshot while the live database is open", async (t) => {
  const { databasePath, backupDir, store } = await fixture(t)
  seed(store)

  const result = await createBackup({
    databasePath,
    backupDir,
    now: new Date("2026-07-14T06:00:00.000Z"),
  })

  assert.equal(result.integrity, "ok")
  assert.equal(result.journalMode, "delete")
  assert.deepEqual(result.tableRows, {
    daily_visitors: 1,
    reactions: 1,
    views: 1,
    visitors: 1,
  })
  assert.match(result.snapshot, /^reactions-20260714T060000000Z\.sqlite$/)
  assert.equal((await fs.stat(result.snapshotPath)).mode & 0o777, 0o600)
  assert.equal((await fs.stat(backupDir)).mode & 0o777, 0o700)
  assert.equal((await verifySnapshot(result.snapshotPath)).sha256, result.sha256)
  assert.deepEqual(
    (await fs.readdir(backupDir)).filter((name) => /-(?:journal|shm|wal)$/.test(name)),
    [],
  )
})

test("retention keeps the newest complete sets and removes partial artifacts", async (t) => {
  const { databasePath, backupDir, store } = await fixture(t)
  seed(store)

  for (const hour of [1, 2]) {
    await createBackup({
      databasePath,
      backupDir,
      now: new Date(`2026-07-14T0${hour}:00:00.000Z`),
      retentionCount: 2,
    })
  }
  await fs.writeFile(path.join(backupDir, "abandoned.sqlite.partial"), "partial")
  await fs.writeFile(
    path.join(backupDir, "reactions-20260714T020000000Z.sqlite-wal"),
    "stale sidecar",
  )
  await fs.writeFile(
    path.join(backupDir, "reactions-20260714T020000000Z.sqlite.7.partial-shm"),
    "stale sidecar",
  )
  seed(store, "2")
  const latest = await createBackup({
    databasePath,
    backupDir,
    now: new Date("2026-07-14T03:00:00.000Z"),
    retentionCount: 2,
  })

  const names = (await fs.readdir(backupDir)).sort()
  assert.deepEqual(
    names.filter((name) => name.endsWith(".sqlite")),
    ["reactions-20260714T020000000Z.sqlite", "reactions-20260714T030000000Z.sqlite"],
  )
  assert.equal(names.includes("abandoned.sqlite.partial"), false)
  assert.equal(
    names.some((name) => /-(?:journal|shm|wal)$/.test(name)),
    false,
  )
  assert.equal(
    JSON.parse(await fs.readFile(path.join(backupDir, "latest.json"), "utf8")).sha256,
    latest.sha256,
  )
})

test("health rejects stale or corrupted snapshots", async (t) => {
  const { databasePath, backupDir, store } = await fixture(t)
  seed(store)
  const createdAt = new Date("2026-07-14T04:00:00.000Z")
  const result = await createBackup({ databasePath, backupDir, now: createdAt })

  const health = await backupHealth({
    backupDir,
    now: new Date("2026-07-14T05:00:00.000Z"),
    maxAgeMs: 2 * 60 * 60 * 1000,
  })
  assert.equal(health.ageMs, 60 * 60 * 1000)

  await assert.rejects(
    backupHealth({
      backupDir,
      now: new Date("2026-07-14T07:00:00.001Z"),
      maxAgeMs: 2 * 60 * 60 * 1000,
    }),
    /stale/,
  )

  const manifestSource = await fs.readFile(result.manifestPath, "utf8")
  await fs.writeFile(result.manifestPath, "{}\n")
  await assert.rejects(
    backupHealth({ backupDir, now: new Date("2026-07-14T05:00:00.000Z") }),
    /metadata.*manifest/i,
  )
  await fs.writeFile(result.manifestPath, manifestSource)
  await fs.appendFile(result.snapshotPath, "corrupt")
  await assert.rejects(
    backupHealth({ backupDir, now: new Date("2026-07-14T05:00:00.000Z") }),
    /checksum|integrity/i,
  )
})

test("latest verified metadata omits server-local paths and volatile age", async (t) => {
  const { databasePath, backupDir, store } = await fixture(t)
  seed(store)
  const result = await createBackup({
    databasePath,
    backupDir,
    now: new Date("2026-07-14T04:00:00.000Z"),
  })

  const latest = await latestVerifiedBackup({
    backupDir,
    now: new Date("2026-07-14T05:00:00.000Z"),
  })
  assert.equal(latest.snapshot, result.snapshot)
  assert.equal(latest.sha256, result.sha256)
  assert.equal("snapshotPath" in latest, false)
  assert.equal("ageMs" in latest, false)
})

test("restore creates a separately verified database and never overwrites a destination", async (t) => {
  const { root, databasePath, backupDir, store } = await fixture(t)
  seed(store)
  const result = await createBackup({
    databasePath,
    backupDir,
    now: new Date("2026-07-14T06:00:00.000Z"),
  })
  const destinationPath = path.join(root, "restore", "reactions.sqlite")

  const restored = await restoreSnapshot({
    snapshotPath: result.snapshotPath,
    destinationPath,
  })
  assert.deepEqual(restored.tableRows, result.tableRows)
  await assert.rejects(
    restoreSnapshot({ snapshotPath: result.snapshotPath, destinationPath }),
    /already exists/,
  )

  const drill = await runRestoreDrill({ backupDir })
  assert.equal(drill.snapshot, result.snapshot)
  assert.deepEqual(drill.tableRows, result.tableRows)
})

test("backup lock prevents overlapping writers", async (t) => {
  const { databasePath, backupDir, store } = await fixture(t)
  seed(store)
  await fs.mkdir(backupDir, { recursive: true })
  await fs.writeFile(path.join(backupDir, ".backup.lock"), "busy")

  await assert.rejects(createBackup({ databasePath, backupDir }), /already running/)
})

test("backup replaces a lock left by a retired container", async (t) => {
  const { databasePath, backupDir, store } = await fixture(t)
  seed(store)
  await fs.mkdir(backupDir, { recursive: true })
  await fs.writeFile(
    path.join(backupDir, ".backup.lock"),
    `${JSON.stringify({ hostname: "retired-container", pid: 1, token: "old" })}\n`,
  )

  const result = await createBackup({ databasePath, backupDir })
  assert.equal(result.integrity, "ok")
})

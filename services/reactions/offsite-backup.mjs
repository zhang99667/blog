import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { promises as fs } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { restoreSnapshot, verifySnapshot } from "./backup.mjs"

const BUNDLE_VERSION = "1.0.0"
const BUNDLE_MANIFEST = "bundle.json"
const SNAPSHOT_PATTERN = /^reactions-\d{8}T\d{9}Z(?:-\d+)?\.sqlite$/

async function sha256File(file) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

function assertSafeSnapshotName(name) {
  if (!SNAPSHOT_PATTERN.test(name ?? "") || path.basename(name) !== name) {
    throw new Error("Off-site backup snapshot name is invalid")
  }
}

function assertValidDate(value, field) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be an ISO timestamp`)
  }
  return date
}

function assertEqual(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Off-site backup ${field} does not match the verified snapshot`)
  }
}

export async function verifyBackupSet({ snapshotPath, manifestPath } = {}) {
  if (!snapshotPath) throw new Error("snapshotPath is required")
  if (!manifestPath) throw new Error("manifestPath is required")

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
  assertSafeSnapshotName(manifest.snapshot)
  assertValidDate(manifest.createdAt, "createdAt")
  if (path.basename(snapshotPath) !== manifest.snapshot) {
    throw new Error("Off-site backup snapshot filename does not match its manifest")
  }
  if (path.basename(manifestPath) !== manifest.snapshot.replace(/\.sqlite$/, ".json")) {
    throw new Error("Off-site backup companion manifest filename is invalid")
  }

  const verification = await verifySnapshot(snapshotPath)
  for (const field of [
    "bytes",
    "sha256",
    "pageCount",
    "pageSize",
    "tableRows",
    "integrity",
    "foreignKeys",
    "journalMode",
  ]) {
    assertEqual(manifest[field], verification[field], field)
  }
  return { manifest, verification }
}

export async function createOffsiteBundleManifest({
  directory,
  snapshotName,
  exportedAt = new Date(),
  source = "markz-production",
  repository,
  runId,
  runAttempt,
  commit,
} = {}) {
  if (!directory) throw new Error("directory is required")
  assertSafeSnapshotName(snapshotName)
  const exported = exportedAt instanceof Date ? exportedAt : new Date(exportedAt)
  if (Number.isNaN(exported.getTime())) throw new Error("exportedAt must be a valid date")

  const snapshotPath = path.join(directory, snapshotName)
  const manifestName = snapshotName.replace(/\.sqlite$/, ".json")
  const manifestPath = path.join(directory, manifestName)
  const { manifest } = await verifyBackupSet({ snapshotPath, manifestPath })
  const workflow = Object.fromEntries(
    Object.entries({ repository, runId, runAttempt, commit }).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  )
  const bundle = {
    version: BUNDLE_VERSION,
    exportedAt: exported.toISOString(),
    source,
    snapshot: {
      name: snapshotName,
      manifest: manifestName,
      createdAt: manifest.createdAt,
      bytes: manifest.bytes,
      sha256: manifest.sha256,
      manifestSha256: await sha256File(manifestPath),
      tableRows: manifest.tableRows,
    },
    ...(Object.keys(workflow).length > 0 ? { workflow } : {}),
  }
  const outputPath = path.join(directory, BUNDLE_MANIFEST)
  await fs.writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 })
  await fs.chmod(outputPath, 0o600)
  return { ...bundle, outputPath }
}

export async function verifyOffsiteBundle(directory) {
  if (!directory) throw new Error("directory is required")
  const manifestPath = path.join(directory, BUNDLE_MANIFEST)
  const bundle = JSON.parse(await fs.readFile(manifestPath, "utf8"))
  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error("Off-site backup bundle version is unsupported")
  }
  assertValidDate(bundle.exportedAt, "exportedAt")
  assertSafeSnapshotName(bundle.snapshot?.name)
  const expectedManifest = bundle.snapshot.name.replace(/\.sqlite$/, ".json")
  if (bundle.snapshot.manifest !== expectedManifest) {
    throw new Error("Off-site backup bundle manifest name is invalid")
  }

  const names = (await fs.readdir(directory)).sort()
  const expectedNames = [BUNDLE_MANIFEST, bundle.snapshot.manifest, bundle.snapshot.name].sort()
  assertEqual(names, expectedNames, "file set")
  const snapshotPath = path.join(directory, bundle.snapshot.name)
  const companionPath = path.join(directory, bundle.snapshot.manifest)
  if ((await sha256File(companionPath)) !== bundle.snapshot.manifestSha256) {
    throw new Error("Off-site backup companion manifest checksum does not match")
  }
  const { manifest } = await verifyBackupSet({
    snapshotPath,
    manifestPath: companionPath,
  })
  for (const field of ["createdAt", "bytes", "sha256", "tableRows"]) {
    assertEqual(bundle.snapshot[field], manifest[field], `bundle ${field}`)
  }
  return { bundle, manifest, snapshotPath }
}

export async function restoreOffsiteBundle({ directory, destinationPath } = {}) {
  if (!destinationPath) throw new Error("destinationPath is required")
  const verified = await verifyOffsiteBundle(directory)
  const restored = await restoreSnapshot({
    snapshotPath: verified.snapshotPath,
    destinationPath,
  })
  assertEqual(restored.tableRows, verified.manifest.tableRows, "restored table rows")
  return { ...restored, snapshot: verified.manifest.snapshot }
}

async function main() {
  const command = process.argv[2]
  if (command === "prepare") {
    const directory = process.argv[3]
    const snapshotName = process.argv[4]
    const result = await createOffsiteBundleManifest({
      directory,
      snapshotName,
      exportedAt: process.env.BACKUP_EXPORTED_AT ?? new Date(),
      repository: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      commit: process.env.GITHUB_SHA,
    })
    console.log(JSON.stringify(result))
    return
  }
  if (command === "verify") {
    const result = await verifyOffsiteBundle(process.argv[3])
    console.log(
      JSON.stringify({ snapshot: result.manifest.snapshot, tableRows: result.manifest.tableRows }),
    )
    return
  }
  if (command === "restore") {
    const result = await restoreOffsiteBundle({
      directory: process.argv[3],
      destinationPath: process.argv[4],
    })
    console.log(`Restored off-site backup ${result.snapshot} to ${result.destinationPath}`)
    return
  }
  throw new Error(`Unknown off-site backup command: ${command ?? ""}`)
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

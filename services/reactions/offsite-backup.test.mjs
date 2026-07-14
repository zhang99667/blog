import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { createBackup } from "./backup.mjs"
import {
  createOffsiteBundleManifest,
  restoreOffsiteBundle,
  verifyOffsiteBundle,
} from "./offsite-backup.mjs"
import { createReactionStore } from "./server.mjs"

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "markz-offsite-backup-test-"))
  const databasePath = path.join(root, "data", "reactions.sqlite")
  const backupDir = path.join(root, "backups")
  const store = createReactionStore(databasePath)
  store.addVisitor("00000000-0000-4000-8000-000000000001", "2026-07-14")
  store.addView("blog", "blog/offsite", "00000000-0000-4000-8000-000000000001")
  store.addLike("blog", "blog/offsite", "00000000-0000-4000-8000-000000000001")
  const snapshot = await createBackup({
    databasePath,
    backupDir,
    now: new Date("2026-07-14T12:00:00.000Z"),
  })
  const bundleDir = path.join(root, "bundle")
  await fs.mkdir(bundleDir, { mode: 0o700 })
  await fs.copyFile(snapshot.snapshotPath, path.join(bundleDir, snapshot.snapshot))
  await fs.copyFile(
    snapshot.manifestPath,
    path.join(bundleDir, path.basename(snapshot.manifestPath)),
  )
  t.after(async () => {
    store.close()
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, backupDir, bundleDir, snapshot }
}

test("off-site bundle records and verifies an exact recoverable snapshot", async (t) => {
  const { root, bundleDir, snapshot } = await fixture(t)
  const bundle = await createOffsiteBundleManifest({
    directory: bundleDir,
    snapshotName: snapshot.snapshot,
    exportedAt: new Date("2026-07-14T12:30:00.000Z"),
    repository: "zhang99667/blog",
    runId: "123",
    runAttempt: "1",
    commit: "a".repeat(40),
  })

  assert.equal(bundle.version, "1.0.0")
  assert.equal(bundle.snapshot.sha256, snapshot.sha256)
  assert.deepEqual((await verifyOffsiteBundle(bundleDir)).manifest.tableRows, snapshot.tableRows)

  const destinationPath = path.join(root, "restore", "reactions.sqlite")
  const restored = await restoreOffsiteBundle({ directory: bundleDir, destinationPath })
  assert.deepEqual(restored.tableRows, snapshot.tableRows)
  await assert.rejects(
    restoreOffsiteBundle({ directory: bundleDir, destinationPath }),
    /already exists/,
  )
})

test("off-site verification rejects altered metadata and unexpected plaintext files", async (t) => {
  const { bundleDir, snapshot } = await fixture(t)
  await createOffsiteBundleManifest({
    directory: bundleDir,
    snapshotName: snapshot.snapshot,
    exportedAt: new Date("2026-07-14T12:30:00.000Z"),
  })

  await fs.writeFile(path.join(bundleDir, "unexpected.txt"), "not part of the bundle")
  await assert.rejects(verifyOffsiteBundle(bundleDir), /file set/)
  await fs.rm(path.join(bundleDir, "unexpected.txt"))

  const manifestPath = path.join(bundleDir, path.basename(snapshot.manifestPath))
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
  manifest.tableRows.views += 1
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await assert.rejects(verifyOffsiteBundle(bundleDir), /checksum|tableRows/)
})

test("off-site preparation rejects path-like snapshot names", async (t) => {
  const { backupDir } = await fixture(t)
  await assert.rejects(
    createOffsiteBundleManifest({
      directory: backupDir,
      snapshotName: "../reactions-20260714T120000000Z.sqlite",
    }),
    /snapshot name is invalid/,
  )
})

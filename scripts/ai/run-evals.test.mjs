import assert from "node:assert/strict"
import { test } from "node:test"
import {
  collectArticleSocialImageFailures,
  collectBrowserContractFailures,
  collectCiActionLifecycleFailures,
  collectContentBoundaryFailures,
  collectGraphRuntimeBoundaryFailures,
  collectRoutingContractFailures,
  collectRuntimeBackupBoundaryFailures,
  validateCiActionLifecycle,
} from "./run-evals.mjs"

test("routing ownership contract matches the repository", async () => {
  assert.deepEqual(await collectRoutingContractFailures(), [])
})

test("content surface roles remain separate", async () => {
  assert.deepEqual(await collectContentBoundaryFailures(), [])
})

test("browser quality matrix covers required themes and widths", async () => {
  assert.deepEqual(await collectBrowserContractFailures(), [])
})

test("runtime backup remains isolated, verified, and restore-tested", async () => {
  assert.deepEqual(await collectRuntimeBackupBoundaryFailures(), [])
})

test("notes Graph runtime remains pinned, self-hosted, and build-verified", async () => {
  assert.deepEqual(await collectGraphRuntimeBoundaryFailures(), [])
})

test("article social images remain local, governed, and budgeted", async () => {
  assert.deepEqual(await collectArticleSocialImageFailures(), [])
})

test("CI Actions remain immutable, current, and automatically maintained", async () => {
  assert.deepEqual(await collectCiActionLifecycleFailures(), [])
})

test("CI Action lifecycle rejects floating refs, retired runtimes, and missing updates", () => {
  const workflow = `
jobs:
  verify:
    steps:
      - uses: actions/checkout@v7 # v7.0.0
      - uses: actions/setup-node@${"b".repeat(40)} # v7.0.0
      - uses: actions/upload-artifact@${"c".repeat(40)} # v4.6.2
`
  const failures = validateCiActionLifecycle(
    [{ path: ".github/workflows/test.yaml", source: workflow }],
    "version: 2\nupdates: []\n",
  )
  assert.ok(failures.some((failure) => failure.includes("full commit SHA")))
  assert.ok(failures.some((failure) => failure.includes("upload-artifact v4.6.2")))
  assert.ok(failures.some((failure) => failure.includes("Dependabot must govern")))
})

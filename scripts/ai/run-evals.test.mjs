import assert from "node:assert/strict"
import { test } from "node:test"
import {
  collectArticleSocialImageFailures,
  collectBrowserContractFailures,
  collectContentBoundaryFailures,
  collectGraphRuntimeBoundaryFailures,
  collectRoutingContractFailures,
  collectRuntimeBackupBoundaryFailures,
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

import assert from "node:assert/strict"
import { test } from "node:test"
import {
  collectBrowserContractFailures,
  collectContentBoundaryFailures,
  collectRoutingContractFailures,
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

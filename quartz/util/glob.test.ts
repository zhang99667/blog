import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { glob } from "./glob"

test("glob can include generated content that Git ignores", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quartz-glob-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  await fs.mkdir(path.join(root, "generated"))
  await fs.writeFile(path.join(root, ".gitignore"), "generated/\n")
  await fs.writeFile(path.join(root, "generated", "index.md"), "# Generated\n")

  assert.deepEqual(await glob("**/*.*", root, [], false), [])
  assert.deepEqual(await glob("**/*.*", root, [], true), ["generated/index.md"])
})

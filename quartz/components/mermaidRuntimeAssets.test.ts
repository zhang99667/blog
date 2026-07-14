import assert from "node:assert/strict"
import { resolve } from "path"
import { describe, test } from "node:test"
import {
  buildMermaidRuntimeAsset,
  isMermaidRuntimeHost,
  mermaidRuntimeVersion,
} from "./mermaidRuntimeAssets"

describe("Mermaid runtime asset", () => {
  test("converts the pinned browser build into a self-hosted ESM module", async () => {
    const projectRoot = resolve(import.meta.dirname, "../..")
    const packageJson = await import("../../node_modules/@mermaid-js/tiny/package.json", {
      with: { type: "json" },
    })
    const output = (await buildMermaidRuntimeAsset(projectRoot)).toString("utf8")

    assert.equal(packageJson.default.version, mermaidRuntimeVersion)
    assert.match(output, /export \{ mermaid as default \}/)
    assert.doesNotMatch(output, /globalThis\.__esbuild_esm_mermaid_nm/)
  })

  test("emits the root asset only on public host builds", () => {
    assert.equal(isMermaidRuntimeHost("blog"), true)
    assert.equal(isMermaidRuntimeHost("notes"), true)
    assert.equal(isMermaidRuntimeHost("notes-fallback"), false)
  })
})

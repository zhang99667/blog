import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  bundleGraphRuntimeAsset,
  d3GraphRuntimeAsset,
  graphRuntimeVersions,
  isGraphRuntimeSite,
  pixiGraphRuntimeAsset,
} from "./graphRuntimeAssets"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

describe("Graph runtime dependency boundary", () => {
  test("pins the upstream libraries and scopes them to notes builds", () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))

    assert.equal(packageJson.dependencies.d3, graphRuntimeVersions.d3)
    assert.equal(packageJson.dependencies["pixi.js"], graphRuntimeVersions.pixi)
    assert.equal(isGraphRuntimeSite("notes"), true)
    assert.equal(isGraphRuntimeSite("notes-fallback"), true)
    assert.equal(isGraphRuntimeSite("blog"), false)
  })

  test("builds focused browser bundles instead of shipping full distributions", async () => {
    const [d3, pixi] = await Promise.all([
      bundleGraphRuntimeAsset(d3GraphRuntimeAsset, root),
      bundleGraphRuntimeAsset(pixiGraphRuntimeAsset, root),
    ])

    assert.ok(d3.byteLength < 70_000, `D3 Graph runtime is ${d3.byteLength} bytes`)
    assert.ok(pixi.byteLength < 550_000, `Pixi Graph runtime is ${pixi.byteLength} bytes`)
    assert.match(d3.toString(), /\.d3=/)
    assert.match(pixi.toString(), /\.PIXI=/)
  })
})

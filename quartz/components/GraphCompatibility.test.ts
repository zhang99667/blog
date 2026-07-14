import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { patchGraphPathDecoding, patchGraphRenderGeneration } from "./GraphCompatibility"

describe("Graph URL compatibility", () => {
  test("decodes an encoded browser pathname before graph lookup", () => {
    const source = "function getSlug(){return window.location.pathname}"
    const patched = patchGraphPathDecoding(source)

    assert.equal(patched, "function getSlug(){return decodeURI(window.location.pathname)}")
    assert.equal(
      decodeURI("/ai/agent-mcp-%E5%AE%8C%E5%85%A8%E6%8C%87%E5%8D%97"),
      "/ai/agent-mcp-完全指南",
    )
  })

  test("preserves multi-script resources", () => {
    assert.deepEqual(
      patchGraphPathDecoding(["const before = true", "const slug = window.location.pathname"]),
      ["const before = true", "const slug = decodeURI(window.location.pathname)"],
    )
  })

  test("fails when an upstream update removes or duplicates the guarded lookup", () => {
    assert.throws(() => patchGraphPathDecoding("const slug = document.body.dataset.slug"), {
      message: "Expected one Graph URL pathname lookup, found 0",
    })
    assert.throws(
      () =>
        patchGraphPathDecoding(
          "const first = window.location.pathname; const second = window.location.pathname",
        ),
      { message: "Expected one Graph URL pathname lookup, found 2" },
    )
  })
})

describe("Graph render lifecycle compatibility", () => {
  const source =
    "async function D(d,w,g){if(g!==void 0&&g!==E)return function(){};try{var data=await fetchData;map=new Map}catch(i){return function(){}}var Z=new PIXI.Application;await Z.init({}),d.appendChild(Z.canvas)}"

  test("stops stale generations before and after PIXI initialization", () => {
    const patched = patchGraphRenderGeneration(source)
    if (typeof patched !== "string") assert.fail("Expected a patched Graph script")

    assert.equal(patched.match(/g!==void 0&&g!==E/g)?.length, 3)
    assert.match(patched, /await fetchData;if\(g!==void 0&&g!==E\)return function\(\)\{\};/)
    assert.match(patched, /Z\.destroy\(!0\);return function\(\)\{\}\}d\.appendChild\(Z\.canvas\)/)
  })

  test("preserves multi-script resources and rejects upstream marker drift", () => {
    const patched = patchGraphRenderGeneration(["const before = true", source])
    if (!Array.isArray(patched)) assert.fail("Expected patched Graph scripts")
    assert.equal(patched[0], "const before = true")
    assert.match(patched[1], /Z\.destroy\(!0\)/)

    assert.throws(() => patchGraphRenderGeneration("const graph = {}"), {
      message: "Expected one Graph render checkpoint, found generation=0 fetch=0 canvas=0",
    })
  })
})

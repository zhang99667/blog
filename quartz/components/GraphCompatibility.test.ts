import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { patchGraphPathDecoding } from "./GraphCompatibility"

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

import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { patchMermaidRuntimeSource } from "./MermaidCompatibility"
import { mermaidRuntimeAsset } from "./mermaidRuntimeAssets"

describe("Mermaid runtime compatibility", () => {
  test("replaces the upstream CDN module with the pinned local runtime", () => {
    const source =
      'const mermaid = await import("https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.0/mermaid.esm.min.mjs")'
    const patched = patchMermaidRuntimeSource(source)

    assert.doesNotMatch(patched, /cdnjs\.cloudflare\.com/)
    assert.match(
      patched,
      new RegExp(`import\\(new URL\\(\"/${mermaidRuntimeAsset.path.replaceAll(".", "\\.")}\"`),
    )
  })

  test("leaves unrelated resources untouched and rejects duplicate imports", () => {
    assert.equal(patchMermaidRuntimeSource("const local = true"), "const local = true")
    assert.throws(
      () =>
        patchMermaidRuntimeSource(
          'import("https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.0/mermaid.esm.min.mjs"); import("https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.0/mermaid.esm.min.mjs")',
        ),
      { message: "Expected one Mermaid runtime URL, found 2" },
    )
  })
})

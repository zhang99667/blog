import { mermaidRuntimeAsset } from "./mermaidRuntimeAssets"

const remoteMermaidRuntime =
  /(["'])https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/mermaid\/[^"']+\/mermaid\.esm\.min\.mjs\1/g

export function patchMermaidRuntimeSource(source: string): string {
  const matches = source.match(remoteMermaidRuntime) ?? []
  if (matches.length === 0) return source
  if (matches.length !== 1) {
    throw new Error(`Expected one Mermaid runtime URL, found ${matches.length}`)
  }

  return source.replace(
    remoteMermaidRuntime,
    `new URL("/${mermaidRuntimeAsset.path}", location.origin).href`,
  )
}

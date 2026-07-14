import fs from "fs"
import { resolve } from "path"

export const mermaidRuntimeVersion = "11.16.0"

export const mermaidRuntimeAsset = {
  file: `vendor/mermaid-tiny-${mermaidRuntimeVersion}.esm.min.js`,
  path: `static/vendor/mermaid-tiny-${mermaidRuntimeVersion}.esm.min.js`,
  packagePath: "node_modules/@mermaid-js/tiny/dist/mermaid.tiny.js",
} as const

const browserGlobalExport =
  'globalThis["mermaid"] = globalThis.__esbuild_esm_mermaid_nm["mermaid"].default;'

export function isMermaidRuntimeHost(site = process.env.QUARTZ_SITE ?? "blog"): boolean {
  return site === "blog" || site === "notes"
}

export async function buildMermaidRuntimeAsset(projectRoot: string): Promise<Buffer> {
  const packagePath = resolve(projectRoot, mermaidRuntimeAsset.packagePath)
  const source = await fs.promises.readFile(packagePath, "utf8")
  const matches = source.split(browserGlobalExport).length - 1
  if (matches !== 1) {
    throw new Error(`Expected one Mermaid browser-global export, found ${matches}`)
  }

  const moduleExport = `
const mermaid = __esbuild_esm_mermaid_nm["mermaid"].default;
globalThis["mermaid"] = mermaid;
export { mermaid as default };
`
  return Buffer.from(source.replace(browserGlobalExport, moduleExport))
}

import { build } from "esbuild"

export const graphRuntimeVersions = {
  d3: "7.9.0",
  pixi: "8.19.0",
} as const

export type GraphRuntimeAsset = Readonly<{
  id: keyof typeof graphRuntimeVersions
  file: string
  path: string
  source: string
}>

export const d3GraphRuntimeAsset: GraphRuntimeAsset = {
  id: "d3",
  file: `vendor/d3-graph-${graphRuntimeVersions.d3}.iife.min.js`,
  path: `static/vendor/d3-graph-${graphRuntimeVersions.d3}.iife.min.js`,
  source: `
    import {
      drag,
      forceCenter,
      forceCollide,
      forceLink,
      forceManyBody,
      forceRadial,
      forceSimulation,
      select,
      zoom,
      zoomIdentity,
    } from "d3"

    globalThis.d3 = {
      drag,
      forceCenter,
      forceCollide,
      forceLink,
      forceManyBody,
      forceRadial,
      forceSimulation,
      select,
      zoom,
      zoomIdentity,
    }
  `,
}

export const pixiGraphRuntimeAsset: GraphRuntimeAsset = {
  id: "pixi",
  file: `vendor/pixi-graph-${graphRuntimeVersions.pixi}.iife.min.js`,
  path: `static/vendor/pixi-graph-${graphRuntimeVersions.pixi}.iife.min.js`,
  source: `
    import { Application, Container, Graphics, Text } from "pixi.js"
    globalThis.PIXI = { Application, Container, Graphics, Text }
  `,
}

export const graphRuntimeAssets = [d3GraphRuntimeAsset, pixiGraphRuntimeAsset] as const

export function isGraphRuntimeSite(site = process.env.QUARTZ_SITE ?? "blog"): boolean {
  return site === "notes" || site === "notes-fallback"
}

export async function bundleGraphRuntimeAsset(
  asset: GraphRuntimeAsset,
  projectRoot: string,
): Promise<Buffer> {
  const result = await build({
    stdin: {
      contents: asset.source,
      resolveDir: projectRoot,
      sourcefile: `${asset.id}-graph-runtime.js`,
    },
    bundle: true,
    format: "iife",
    legalComments: "eof",
    minify: true,
    platform: "browser",
    target: ["chrome109", "edge115", "firefox102", "safari15.6"],
    treeShaking: true,
    write: false,
  })

  if (result.outputFiles.length !== 1) {
    throw new Error(`Expected one ${asset.id} Graph runtime bundle`)
  }
  return Buffer.from(result.outputFiles[0].contents)
}

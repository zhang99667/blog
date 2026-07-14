import type { StringResource } from "../util/resources"
import { componentRegistry } from "./registry"
import type { QuartzComponent, QuartzComponentConstructor } from "./types"
import {
  d3GraphRuntimeAsset,
  isGraphRuntimeSite,
  pixiGraphRuntimeAsset,
} from "./graphRuntimeAssets"

const upstreamGraphKey = "graph/Graph"
const graphPathExpression = "window.location.pathname"
const decodedGraphPathExpression = "decodeURI(window.location.pathname)"
const graphFetchMarker = "await fetchData;"
const graphRuntimeSources = [
  {
    remote: '"https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"',
    local: d3GraphRuntimeAsset.path,
  },
  {
    remote: '"https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.js"',
    local: pixiGraphRuntimeAsset.path,
  },
] as const
const identifierPattern = "[A-Za-z_$][\\w$]*"
const graphStaleGenerationPattern = new RegExp(
  `(${identifierPattern})!==void 0&&\\1!==(${identifierPattern})`,
)
const graphAppendCanvasPattern = new RegExp(
  `([,;])(${identifierPattern})\\.appendChild\\((${identifierPattern})\\.canvas\\);?`,
  "g",
)
const overrideSource = "local:markz-graph-compatibility"

type GraphConstructor = QuartzComponentConstructor<Record<string, unknown> | undefined>

let upstreamGraph: GraphConstructor | undefined

export function patchGraphRuntimeSources(resource: StringResource): StringResource {
  const scripts = Array.isArray(resource) ? resource : resource ? [resource] : []
  const matches = new Map(graphRuntimeSources.map(({ remote }) => [remote, 0]))
  const patched = scripts.map((script) => {
    let result = script
    for (const { remote, local } of graphRuntimeSources) {
      const count = result.split(remote).length - 1
      matches.set(remote, (matches.get(remote) ?? 0) + count)
      const localExpression = `((document.body&&document.body.dataset.basepath)||"")+"/${local}"`
      result = result.replaceAll(remote, localExpression)
    }
    return result
  })

  const invalid = [...matches.entries()].filter(([, count]) => count !== 1)
  if (invalid.length > 0) {
    throw new Error(
      `Expected one Graph runtime URL for each dependency, found ${invalid
        .map(([remote, count]) => `${remote}=${count}`)
        .join(" ")}`,
    )
  }

  return Array.isArray(resource) ? patched : patched[0]
}

export function patchGraphPathDecoding(resource: StringResource): StringResource {
  const scripts = Array.isArray(resource) ? resource : resource ? [resource] : []
  let matches = 0
  const patched = scripts.map((script) => {
    const scriptMatches = script.split(graphPathExpression).length - 1
    matches += scriptMatches
    return scriptMatches === 0
      ? script
      : script.replace(graphPathExpression, decodedGraphPathExpression)
  })

  if (matches !== 1) {
    throw new Error(`Expected one Graph URL pathname lookup, found ${matches}`)
  }

  return Array.isArray(resource) ? patched : patched[0]
}

export function patchGraphRenderGeneration(resource: StringResource): StringResource {
  const scripts = Array.isArray(resource) ? resource : resource ? [resource] : []
  let staleGenerationMatches = 0
  let fetchMatches = 0
  let appendCanvasMatches = 0
  const patched = scripts.map((script) => {
    const staleGeneration = script.match(graphStaleGenerationPattern)
    const scriptFetchMatches = script.split(graphFetchMarker).length - 1
    const canvasMatches = [...script.matchAll(graphAppendCanvasPattern)]
    if (staleGeneration) staleGenerationMatches += 1
    fetchMatches += scriptFetchMatches
    appendCanvasMatches += canvasMatches.length
    if (!staleGeneration || scriptFetchMatches === 0 || canvasMatches.length === 0) return script

    const generation = staleGeneration[1]
    const currentGeneration = staleGeneration[2]
    const generationGuard = `if(${generation}!==void 0&&${generation}!==${currentGeneration})return function(){};`
    return script
      .replace(graphFetchMarker, `${graphFetchMarker}${generationGuard}`)
      .replace(graphAppendCanvasPattern, (_marker, _separator, graph, app) => {
        const initializedGuard = `if(${generation}!==void 0&&${generation}!==${currentGeneration}){${app}.destroy(!0);return function(){}}`
        return `;${initializedGuard}${graph}.appendChild(${app}.canvas);`
      })
  })

  if (staleGenerationMatches !== 1 || fetchMatches !== 1 || appendCanvasMatches !== 1) {
    throw new Error(
      `Expected one Graph render checkpoint, found generation=${staleGenerationMatches} fetch=${fetchMatches} canvas=${appendCanvasMatches}`,
    )
  }

  return Array.isArray(resource) ? patched : patched[0]
}

function resolveUpstreamGraph(): GraphConstructor {
  if (upstreamGraph) return upstreamGraph

  const registration = componentRegistry.get(upstreamGraphKey)
  if (!registration || registration.component === GraphWithCanonicalSlug) {
    throw new Error("Quartz Graph plugin did not register its component")
  }

  upstreamGraph = registration.component as GraphConstructor
  return upstreamGraph
}

const GraphWithCanonicalSlug: GraphConstructor = (options) => {
  const original = resolveUpstreamGraph()(options)
  const graph = ((props) => original(props)) as QuartzComponent

  Object.assign(graph, original)
  graph.afterDOMLoaded = isGraphRuntimeSite()
    ? patchGraphRenderGeneration(
        patchGraphPathDecoding(patchGraphRuntimeSources(original.afterDOMLoaded)),
      )
    : undefined
  return graph
}

export function registerGraphCompatibilityOverride(): void {
  componentRegistry.replace("Graph", GraphWithCanonicalSlug, overrideSource)
  componentRegistry.replace("graph", GraphWithCanonicalSlug, overrideSource)
}

export function finalizeGraphCompatibilityOverride(): void {
  resolveUpstreamGraph()
  componentRegistry.replace(upstreamGraphKey, GraphWithCanonicalSlug, overrideSource)
}

import type { StringResource } from "../util/resources"
import { componentRegistry } from "./registry"
import type { QuartzComponent, QuartzComponentConstructor } from "./types"

const upstreamGraphKey = "graph/Graph"
const graphPathExpression = "window.location.pathname"
const decodedGraphPathExpression = "decodeURI(window.location.pathname)"
const overrideSource = "local:markz-graph-compatibility"

type GraphConstructor = QuartzComponentConstructor<Record<string, unknown> | undefined>

let upstreamGraph: GraphConstructor | undefined

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
  graph.afterDOMLoaded = patchGraphPathDecoding(original.afterDOMLoaded)
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

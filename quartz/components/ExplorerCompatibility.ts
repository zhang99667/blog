import { componentRegistry } from "./registry"
import type { QuartzComponent, QuartzComponentConstructor } from "./types"
import type { StringResource } from "../util/resources"

const upstreamExplorerKey = "explorer/Explorer"
const overrideSource = "local:markz-explorer-csp-compatibility"
const callbackKeys = ["sortFn", "filterFn", "mapFn"] as const
const identifierPattern = "[A-Za-z_$][\\w$]*"
const executableOptionsPattern = new RegExp(
  `if\\((${identifierPattern})\\)try\\{let (${identifierPattern})=JSON\\.parse\\(\\1\\);[\\s\\S]*?\\}catch\\((${identifierPattern})\\)\\{console\\.error\\(\"Error parsing data functions:\",\\3\\)\\}`,
)

type ExplorerOptions = Record<string, unknown> | undefined
type ExplorerConstructor = QuartzComponentConstructor<ExplorerOptions>

let upstreamExplorer: ExplorerConstructor | undefined

export function sanitizeExplorerOptions(options: ExplorerOptions): Record<string, unknown> {
  for (const key of callbackKeys) {
    if (options?.[key] !== undefined) {
      throw new Error(
        `Custom Explorer ${key} requires a declarative CSP-safe implementation before use`,
      )
    }
  }

  return {
    ...options,
    sortFn: undefined,
    filterFn: undefined,
    mapFn: undefined,
  }
}

export function patchExplorerRuntime(resource: StringResource): StringResource {
  const scripts = Array.isArray(resource) ? resource : resource ? [resource] : []
  let matches = 0
  const patched = scripts.map((script) => {
    const match = script.match(executableOptionsPattern)
    if (!match) return script
    matches += 1
    return script.replace(executableOptionsPattern, "")
  })

  if (matches !== 1) {
    throw new Error(`Expected one Explorer executable-options block, found ${matches}`)
  }

  return Array.isArray(resource) ? patched : patched[0]
}

function resolveUpstreamExplorer(): ExplorerConstructor {
  if (upstreamExplorer) return upstreamExplorer

  const registration = componentRegistry.get(upstreamExplorerKey)
  if (!registration || registration.component === ExplorerWithSafeDefaults) {
    throw new Error("Quartz Explorer plugin did not register its component")
  }

  upstreamExplorer = registration.component as ExplorerConstructor
  return upstreamExplorer
}

const ExplorerWithSafeDefaults: ExplorerConstructor = (options) => {
  const original = resolveUpstreamExplorer()(sanitizeExplorerOptions(options))
  const explorer = ((props) => original(props)) as QuartzComponent

  Object.assign(explorer, original)
  explorer.afterDOMLoaded = patchExplorerRuntime(original.afterDOMLoaded)
  return explorer
}

export function registerExplorerCompatibilityOverride(): void {
  componentRegistry.replace("Explorer", ExplorerWithSafeDefaults, overrideSource)
  componentRegistry.replace("explorer", ExplorerWithSafeDefaults, overrideSource)
}

export function finalizeExplorerCompatibilityOverride(): void {
  resolveUpstreamExplorer()
  componentRegistry.replace(upstreamExplorerKey, ExplorerWithSafeDefaults, overrideSource)
}

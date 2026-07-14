import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, "../..")
const expectedHostPattern = "~^(?:(?:www\\.)?markz\\.fun|note\\.markz\\.fun)$"

export function parseContentSecurityPolicy(value) {
  const directives = new Map()
  for (const segment of value.split(";")) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const [name, ...sources] = tokens
    if (directives.has(name)) throw new Error(`Duplicate CSP directive: ${name}`)
    directives.set(name, sources)
  }
  return directives
}

export function parseNginxContentSecurityPolicy(source) {
  const map = source.match(/map\s+\$host\s+\$markz_content_security_policy\s*\{([\s\S]*?)\n\s*\}/)
  if (!map) throw new Error("Nginx CSP host map is missing")

  const entries = [...map[1].matchAll(/^\s*(\S+)\s+"([^"]*)";\s*$/gm)].map(([, key, value]) => ({
    key,
    value,
  }))
  const fallback = entries.find(({ key }) => key === "default")
  const governed = entries.filter(({ key }) => key !== "default")
  if (fallback?.value !== "") throw new Error("Non-editorial hosts must default to an empty CSP")
  if (governed.length !== 1 || governed[0].key !== expectedHostPattern) {
    throw new Error("CSP must be scoped exactly to markz.fun, www.markz.fun, and note.markz.fun")
  }
  if (!governed[0].value) throw new Error("Editorial CSP must not be empty")

  return {
    value: governed[0].value,
    directives: parseContentSecurityPolicy(governed[0].value),
    hostPattern: governed[0].key,
  }
}

export async function loadContentSecurityPolicy(root = defaultRoot) {
  const source = await fs.readFile(path.join(root, "deploy/nginx.conf"), "utf8")
  return parseNginxContentSecurityPolicy(source)
}

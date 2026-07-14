import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "parse5"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, "../..")

async function readJson(root, relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"))
}

async function listFiles(root, extension) {
  const files = []
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (target.endsWith(extension)) files.push(target)
    }
  }
  await visit(root)
  return files
}

function attributes(node) {
  return Object.fromEntries(
    (node.attrs ?? []).map((attribute) => [attribute.name, attribute.value]),
  )
}

export function inspectHtml(source) {
  const document = parse(source)
  const facts = {
    lang: "",
    title: "",
    meta: new Map(),
    references: [],
    canonical: "",
    alternateRss: "",
    structuredData: [],
    structuredDataErrors: [],
    fontStylesheets: [],
    refresh: "",
  }

  function visit(node) {
    const attrs = attributes(node)
    if (node.nodeName === "html") facts.lang = attrs.lang ?? ""
    if (node.nodeName === "title") {
      facts.title = (node.childNodes ?? [])
        .map((child) => child.value ?? "")
        .join("")
        .trim()
    }
    if (node.nodeName === "meta") {
      const key = attrs.name ?? attrs.property
      if (key) facts.meta.set(key.toLowerCase(), attrs.content ?? "")
      if (attrs["http-equiv"]?.toLowerCase() === "refresh") {
        facts.refresh = attrs.content ?? ""
      }
    }
    if (node.nodeName === "link") {
      const relations = new Set((attrs.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean))
      if (relations.has("canonical")) facts.canonical = attrs.href ?? ""
      if (relations.has("alternate") && attrs.type?.toLowerCase() === "application/rss+xml") {
        facts.alternateRss = attrs.href ?? ""
      }
      if (relations.has("stylesheet") && attrs.href?.startsWith("https://fonts.googleapis.com/")) {
        facts.fontStylesheets.push(attrs.href)
      }
    }
    if (node.nodeName === "script" && attrs.type?.toLowerCase() === "application/ld+json") {
      const body = (node.childNodes ?? []).map((child) => child.value ?? "").join("")
      try {
        facts.structuredData.push(JSON.parse(body))
      } catch (error) {
        facts.structuredDataErrors.push(error.message)
      }
    }
    for (const name of ["href", "src"]) {
      if (attrs[name]) facts.references.push(attrs[name])
    }
    for (const child of node.childNodes ?? []) visit(child)
  }

  visit(document)
  return facts
}

function htmlRoute(relativePath) {
  const normalized = relativePath.replaceAll(path.sep, "/").replace(/\.html$/i, "")
  if (normalized === "index") return ""
  if (normalized.endsWith("/index")) return `${normalized.slice(0, -"index".length)}`
  return normalized
}

export function expectedCanonicalUrl(outputId, relativePath) {
  const normalized = relativePath.replaceAll(path.sep, "/")
  const isFallback = outputId === "blog" && normalized.startsWith("notes/")
  const publicPath = isFallback ? normalized.slice("notes/".length) : normalized
  const origin =
    outputId === "notes" || isFallback ? "https://note.markz.fun/" : "https://markz.fun/"
  return new URL(htmlRoute(publicPath), origin).toString()
}

function hasStructuredType(payloads, type) {
  return payloads.some((payload) => {
    if (payload?.["@type"] === type) return true
    return Array.isArray(payload?.["@graph"])
      ? payload["@graph"].some((node) => node?.["@type"] === type)
      : false
  })
}

export function validateSeoMetadata(relativePath, facts, options) {
  const failures = []
  const { expectedCanonical, expectedFeed, article = false, noindex = false } = options
  if (facts.canonical !== expectedCanonical) {
    failures.push(`${relativePath} canonical must be ${expectedCanonical}`)
  }
  if (facts.alternateRss !== expectedFeed) {
    failures.push(`${relativePath} RSS discovery must be ${expectedFeed}`)
  }
  if (facts.structuredDataErrors.length > 0) {
    failures.push(`${relativePath} has invalid JSON-LD`)
  }
  if (!hasStructuredType(facts.structuredData, "WebPage")) {
    failures.push(`${relativePath} needs WebPage structured data`)
  }
  if (article) {
    if (facts.meta.get("og:type") !== "article") {
      failures.push(`${relativePath} must use the article Open Graph type`)
    }
    if (!facts.meta.get("article:published_time") || !facts.meta.get("article:modified_time")) {
      failures.push(`${relativePath} needs published and modified article metadata`)
    }
    if (!hasStructuredType(facts.structuredData, "BlogPosting")) {
      failures.push(`${relativePath} needs BlogPosting structured data`)
    }
  } else if (facts.meta.get("og:type") !== "website") {
    failures.push(`${relativePath} must use the website Open Graph type`)
  }
  if (noindex && !facts.meta.get("robots")?.toLowerCase().includes("noindex")) {
    failures.push(`${relativePath} fallback content must be noindex`)
  }
  if (facts.fontStylesheets.length !== 1) {
    failures.push(
      `${relativePath} must load exactly one governed Google Fonts stylesheet, found ${facts.fontStylesheets.length}`,
    )
  }
  for (const stylesheet of facts.fontStylesheets) {
    if (/Schibsted|Source%20Sans|IBM%20Plex/i.test(stylesheet)) {
      failures.push(`${relativePath} loads an ungoverned fallback font family`)
    }
  }
  return failures
}

export function validateHtmlMetadata(relativePath, facts) {
  const failures = []
  if (!facts.title) failures.push(`${relativePath} needs a title`)

  if (facts.refresh) {
    if (!/^0\s*;\s*url=\S+/i.test(facts.refresh)) {
      failures.push(`${relativePath} has an invalid redirect target`)
    }
    if (!facts.canonical) failures.push(`${relativePath} redirect needs a canonical link`)
    if (!facts.meta.get("robots")?.toLowerCase().includes("noindex")) {
      failures.push(`${relativePath} redirect needs noindex`)
    }
    return failures
  }

  if (!facts.lang.toLowerCase().startsWith("zh")) failures.push(`${relativePath} needs zh lang`)
  if (!facts.meta.get("description")) failures.push(`${relativePath} needs meta description`)
  if (!facts.meta.get("viewport")) failures.push(`${relativePath} needs viewport metadata`)
  return failures
}

function normalizeReference(reference) {
  if (
    reference.startsWith("#") ||
    reference.startsWith("//") ||
    /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(reference)
  ) {
    return null
  }
  const withoutQuery = reference.split(/[?#]/, 1)[0]
  if (!withoutQuery) return null
  try {
    return decodeURIComponent(withoutQuery)
  } catch {
    return withoutQuery
  }
}

export function referenceCandidates(outputRoot, htmlFile, reference) {
  const normalized = normalizeReference(reference)
  if (!normalized) return []
  const target = normalized.startsWith("/")
    ? path.join(outputRoot, normalized.slice(1))
    : path.resolve(path.dirname(htmlFile), normalized)
  return [target, `${target}.html`, path.join(target, "index.html")]
}

async function existingCandidate(candidates) {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return true
    } catch {
      // Try the next clean-URL representation.
    }
  }
  return false
}

async function sumFileSizes(files) {
  const sizes = await Promise.all(files.map(async (file) => (await fs.stat(file)).size))
  return sizes.reduce((total, size) => total + size, 0)
}

async function validateDiscoveryFiles(outputRoot, outputId, failures) {
  const host = outputId === "notes" ? "note.markz.fun" : "markz.fun"
  try {
    const robots = await fs.readFile(path.join(outputRoot, "robots.txt"), "utf8")
    if (!robots.includes(`Sitemap: https://${host}/sitemap.xml`)) {
      failures.push(`${outputId} robots.txt must declare its canonical sitemap`)
    }
  } catch {
    failures.push(`${outputId} output is missing robots.txt`)
  }

  if (outputId !== "blog") return
  try {
    const rss = await fs.readFile(path.join(outputRoot, "index.xml"), "utf8")
    if (!rss.includes('rel="self" type="application/rss+xml"')) {
      failures.push("blog RSS needs an Atom self-discovery link")
    }
    const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1])
    if (items.length === 0) failures.push("blog RSS must contain editorial posts")
    for (const item of items) {
      const link = item.match(/<link>([^<]+)<\/link>/)?.[1]
      let pathname = ""
      try {
        pathname = new URL(link).pathname
      } catch {
        failures.push("blog RSS contains an invalid item URL")
        continue
      }
      if (!/^\/blog\/[^/]+$/.test(pathname)) {
        failures.push(`blog RSS contains a non-article item: ${link}`)
      }
    }
  } catch {
    failures.push("blog output is missing index.xml")
  }
}

export function literalModuleReferences(source) {
  const references = new Set()
  const patterns = [
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\b(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) references.add(match[1])
  }
  return [...references].sort()
}

function resolveJavaScriptReference(outputRoot, ownerFile, reference) {
  const normalized = normalizeReference(reference)
  if (!normalized || !normalized.endsWith(".js")) return null
  const candidate = normalized.startsWith("/")
    ? path.join(outputRoot, normalized.slice(1))
    : path.resolve(path.dirname(ownerFile), normalized)
  const relative = path.relative(outputRoot, candidate)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null
  return candidate
}

export async function maxInitialJavaScriptBytes(outputRoot, htmlFiles) {
  const dependencies = new Map()
  const sizes = new Map()

  async function moduleDependencies(moduleFile) {
    if (dependencies.has(moduleFile)) return dependencies.get(moduleFile)
    let source
    try {
      source = await fs.readFile(moduleFile, "utf8")
      sizes.set(moduleFile, (await fs.stat(moduleFile)).size)
    } catch {
      dependencies.set(moduleFile, [])
      return []
    }
    const resolved = literalModuleReferences(source)
      .map((reference) => resolveJavaScriptReference(outputRoot, moduleFile, reference))
      .filter(Boolean)
    dependencies.set(moduleFile, resolved)
    return resolved
  }

  let maximum = 0
  for (const htmlFile of htmlFiles) {
    const source = await fs.readFile(htmlFile, "utf8")
    const entries = inspectHtml(source)
      .references.map((reference) => resolveJavaScriptReference(outputRoot, htmlFile, reference))
      .filter(Boolean)
    const visited = new Set()
    const queue = [...entries]
    while (queue.length > 0) {
      const moduleFile = queue.pop()
      if (!moduleFile || visited.has(moduleFile)) continue
      visited.add(moduleFile)
      queue.push(...(await moduleDependencies(moduleFile)))
    }
    const bytes = [...visited].reduce((total, file) => total + (sizes.get(file) ?? 0), 0)
    maximum = Math.max(maximum, bytes)
  }
  return maximum
}

export async function inspectBuildQuality(root = defaultRoot, { useLinkBaseline = true } = {}) {
  const failures = []
  const budgets = await readJson(root, "quality/budgets.json")
  const tokens = await readJson(root, "design-system/tokens.json")
  const baselinePath = path.join(root, "quality/link-baseline.json")
  let knownBroken = []
  try {
    knownBroken = (JSON.parse(await fs.readFile(baselinePath, "utf8")).knownBroken ?? []).map(
      (item) => item.key,
    )
  } catch {
    if (useLinkBaseline) failures.push("quality/link-baseline.json is missing or invalid")
  }
  const knownBrokenSet = new Set(knownBroken)
  const observedBroken = new Map()

  for (const output of budgets.outputs) {
    const outputRoot = path.join(root, output.root)
    const htmlFiles = await listFiles(outputRoot, ".html")
    const cssFiles = await listFiles(outputRoot, ".css")
    const jsFiles = await listFiles(outputRoot, ".js")
    const cssBytes = await sumFileSizes(cssFiles)
    const jsBytes = await sumFileSizes(jsFiles)
    const initialJsBytes = await maxInitialJavaScriptBytes(outputRoot, htmlFiles)
    if (cssBytes > output.maxTotalCssBytes) {
      failures.push(`${output.id} CSS budget exceeded: ${cssBytes} > ${output.maxTotalCssBytes}`)
    }
    if (jsBytes > output.maxTotalJsBytes) {
      failures.push(`${output.id} JS budget exceeded: ${jsBytes} > ${output.maxTotalJsBytes}`)
    }
    if (initialJsBytes > output.maxInitialJsBytes) {
      failures.push(
        `${output.id} initial JS budget exceeded: ${initialJsBytes} > ${output.maxInitialJsBytes}`,
      )
    }
    await validateDiscoveryFiles(outputRoot, output.id, failures)

    const indexFile = path.join(outputRoot, "index.html")
    let indexSource = ""
    try {
      indexSource = await fs.readFile(indexFile, "utf8")
    } catch {
      failures.push(`${output.id} output is missing index.html`)
    }
    for (const snippet of [
      `data-brand-version="${tokens.version}"`,
      `markz-icon-${tokens.brand.assetRevision}.png`,
      `markz-card-${tokens.brand.assetRevision}.png`,
    ]) {
      if (!indexSource.includes(snippet)) failures.push(`${output.id} index is missing ${snippet}`)
    }

    for (const htmlFile of htmlFiles) {
      const source = await fs.readFile(htmlFile, "utf8")
      const relativePath = path.relative(root, htmlFile)
      if (Buffer.byteLength(source) > output.maxHtmlBytes) {
        failures.push(`${relativePath} exceeds the HTML budget`)
      }
      const facts = inspectHtml(source)
      failures.push(...validateHtmlMetadata(relativePath, facts))
      const outputRelativePath = path.relative(outputRoot, htmlFile).replaceAll(path.sep, "/")
      if (!facts.refresh) {
        const isNotFound = /(?:^|\/)404\.html$/i.test(outputRelativePath)
        if (isNotFound) {
          if (!facts.meta.get("robots")?.toLowerCase().includes("noindex")) {
            failures.push(`${relativePath} 404 page needs noindex`)
          }
          if (facts.canonical)
            failures.push(`${relativePath} 404 page must not declare a canonical`)
        } else {
          const isFallback = output.id === "blog" && outputRelativePath.startsWith("notes/")
          const article =
            output.id === "blog" && /^blog\/(?!index\.html$)[^/]+\.html$/i.test(outputRelativePath)
          failures.push(
            ...validateSeoMetadata(relativePath, facts, {
              expectedCanonical: expectedCanonicalUrl(output.id, outputRelativePath),
              expectedFeed:
                output.id === "notes" || isFallback
                  ? "https://note.markz.fun/index.xml"
                  : "https://markz.fun/index.xml",
              article,
              noindex: isFallback,
            }),
          )
        }
      }
      if (facts.meta.get("og:image:type") === "image/.png") {
        failures.push(`${relativePath} contains an invalid image MIME type`)
      }
      if (source.includes("MarkZ Notes"))
        failures.push(`${relativePath} contains retired brand copy`)

      for (const reference of facts.references) {
        if (output.allowedExternalRoutes.includes(reference)) continue
        const candidates = referenceCandidates(outputRoot, htmlFile, reference)
        if (candidates.length > 0 && !(await existingCandidate(candidates))) {
          const key = `${output.id}:${outputRelativePath}::${reference}`
          observedBroken.set(key, {
            key,
            output: output.id,
            file: outputRelativePath,
            reference,
          })
          if (useLinkBaseline && !knownBrokenSet.has(key)) {
            failures.push(`${relativePath} has a new broken local reference: ${reference}`)
          }
        }
      }
    }
  }

  if (useLinkBaseline) {
    for (const key of knownBrokenSet) {
      if (!observedBroken.has(key)) failures.push(`stale broken-link baseline entry: ${key}`)
    }
  }

  return {
    failures,
    brokenReferences: [...observedBroken.values()].sort((first, second) =>
      first.key.localeCompare(second.key),
    ),
  }
}

export async function collectBuildQualityFailures(root = defaultRoot) {
  return (await inspectBuildQuality(root)).failures
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const updateBaseline = process.argv.includes("--update-link-baseline")
  const report = await inspectBuildQuality(defaultRoot, { useLinkBaseline: !updateBaseline })
  if (updateBaseline) {
    await fs.writeFile(
      path.join(defaultRoot, "quality/link-baseline.json"),
      `${JSON.stringify({ version: "1.0.0", knownBroken: report.brokenReferences }, null, 2)}\n`,
    )
    console.log(`Recorded ${report.brokenReferences.length} known broken references.`)
  }
  const { failures } = report
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
  } else {
    console.log("Built pages satisfy metadata, link, brand, and asset budgets.")
  }
}

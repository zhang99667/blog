import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "parse5"
import sharp from "sharp"
import { loadContentSecurityPolicy } from "./content-security-policy.mjs"

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

function srcsetReferences(value) {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
    .filter(Boolean)
}

export function inspectHtml(source) {
  const document = parse(source)
  const facts = {
    lang: "",
    title: "",
    titleAuthority: "",
    meta: new Map(),
    references: [],
    canonical: "",
    alternateRss: "",
    structuredData: [],
    structuredDataErrors: [],
    fontStylesheets: [],
    stylesheets: [],
    refresh: "",
    cspReferences: [],
    inlineExecutableScripts: [],
    inlineEventHandlers: [],
    javascriptUrls: [],
    inlineStyleAttributes: 0,
    inlineStyleElements: 0,
    h1Count: 0,
    images: [],
    authorLinks: [],
  }

  function addCspReference(directive, value, nodeName, attribute) {
    if (value) facts.cspReferences.push({ directive, value, nodeName, attribute })
  }

  function visit(node, parentNodeName = "") {
    const attrs = attributes(node)
    if (node.nodeName === "html") facts.lang = attrs.lang ?? ""
    if (node.nodeName === "title" && parentNodeName === "head") {
      facts.title = (node.childNodes ?? [])
        .map((child) => child.value ?? "")
        .join("")
        .trim()
      facts.titleAuthority = attrs["data-page-title"] ?? ""
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
      if (relations.has("stylesheet") && attrs.href) facts.stylesheets.push(attrs.href)
      if (relations.has("stylesheet")) addCspReference("style-src-elem", attrs.href, "link", "href")
      if (relations.has("preconnect")) addCspReference("connect-src", attrs.href, "link", "href")
      if (relations.has("manifest")) addCspReference("manifest-src", attrs.href, "link", "href")
      if (relations.has("icon")) addCspReference("img-src", attrs.href, "link", "href")
      if (relations.has("preload")) {
        const preloadDirectives = {
          script: "script-src",
          style: "style-src-elem",
          font: "font-src",
          image: "img-src",
          fetch: "connect-src",
        }
        const directive = preloadDirectives[attrs.as]
        if (directive) addCspReference(directive, attrs.href, "link", "href")
      }
    }
    if (node.nodeName === "a") {
      const relations = new Set((attrs.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean))
      if (relations.has("author") && attrs.href) facts.authorLinks.push(attrs.href)
    }
    if (node.nodeName === "script") {
      const scriptType = attrs.type?.toLowerCase() ?? ""
      if (attrs.src) {
        addCspReference("script-src", attrs.src, "script", "src")
      } else if (["application/ld+json", "application/json"].includes(scriptType)) {
        if (scriptType === "application/ld+json") {
          const body = (node.childNodes ?? []).map((child) => child.value ?? "").join("")
          try {
            facts.structuredData.push(JSON.parse(body))
          } catch (error) {
            facts.structuredDataErrors.push(error.message)
          }
        }
      } else {
        facts.inlineExecutableScripts.push(scriptType || "text/javascript")
      }
    }
    if (node.nodeName === "style") {
      const body = (node.childNodes ?? []).map((child) => child.value ?? "").join("")
      if (body.trim()) facts.inlineStyleElements += 1
    }
    if (node.nodeName === "h1") facts.h1Count += 1
    if (node.nodeName === "img") {
      facts.images.push({ src: attrs.src ?? "", alt: attrs.alt ?? "" })
      addCspReference("img-src", attrs.src, "img", "src")
      for (const reference of srcsetReferences(attrs.srcset ?? "")) {
        addCspReference("img-src", reference, "img", "srcset")
      }
    }
    if (node.nodeName === "iframe") addCspReference("frame-src", attrs.src, "iframe", "src")
    if (node.nodeName === "video") {
      addCspReference("media-src", attrs.src, "video", "src")
      addCspReference("img-src", attrs.poster, "video", "poster")
    }
    if (node.nodeName === "audio") addCspReference("media-src", attrs.src, "audio", "src")
    if (node.nodeName === "source") {
      const directive = parentNodeName === "picture" ? "img-src" : "media-src"
      addCspReference(directive, attrs.src, "source", "src")
      for (const reference of srcsetReferences(attrs.srcset ?? "")) {
        addCspReference(directive, reference, "source", "srcset")
      }
    }
    if (node.nodeName === "object") addCspReference("object-src", attrs.data, "object", "data")
    if (node.nodeName === "form") addCspReference("form-action", attrs.action, "form", "action")

    for (const [name, value] of Object.entries(attrs)) {
      if (/^on/i.test(name) && value) facts.inlineEventHandlers.push(`${node.nodeName}.${name}`)
      if (["href", "src", "action", "formaction"].includes(name) && /^javascript:/i.test(value)) {
        facts.javascriptUrls.push(`${node.nodeName}.${name}`)
      }
    }
    if (attrs.style) facts.inlineStyleAttributes += 1
    for (const name of ["href", "src"]) {
      if (attrs[name]) facts.references.push(attrs[name])
    }
    for (const child of node.childNodes ?? []) visit(child, node.nodeName)
  }

  visit(document)
  return facts
}

function stylesheetFilename(reference) {
  if (/^https?:\/\//i.test(reference)) return ""
  return reference.split(/[?#]/, 1)[0].split("/").pop() ?? ""
}

export function validateLegacyStylesheetCompatibility(stylesheets, cssSources) {
  const failures = []
  const localStylesheets = stylesheets.map(stylesheetFilename).filter(Boolean)
  const baseStylesheets = localStylesheets.filter((name) =>
    /^index(?:-[0-9a-f]+)?\.css$/.test(name),
  )
  const splitRequiredStyles = localStylesheets.filter((name) =>
    /^(?:component|custom)(?:-[0-9a-f]+)?\.css$/.test(name),
  )

  if (baseStylesheets.length !== 1) {
    failures.push("must load exactly one compatibility-transformed index stylesheet")
  }
  if (splitRequiredStyles.length > 0) {
    failures.push("must bundle base, component, and custom styles before compatibility transform")
  }
  if (cssSources.some((source) => /@layer\s+quartz-base\b/.test(source))) {
    failures.push("must not hide required styles inside the quartz-base cascade layer")
  }

  return failures
}

function policySources(policy, directive) {
  return policy.directives.get(directive) ?? policy.directives.get("default-src") ?? []
}

function referenceAllowed(reference, documentOrigin, sources) {
  if (!reference || reference.startsWith("#")) return true
  if (/^(?:about:blank|mailto:|tel:)/i.test(reference)) return true

  let url
  try {
    url = new URL(reference, documentOrigin)
  } catch {
    return false
  }

  for (const source of sources) {
    if (source === "*") return true
    if (source === "'self'" && url.origin === documentOrigin) return true
    if (source === `${url.protocol}`) return true
    if (/^https?:\/\//i.test(source)) {
      try {
        const allowed = new URL(source)
        if (allowed.origin === url.origin && url.pathname.startsWith(allowed.pathname)) return true
      } catch {
        // Invalid policy source; the policy contract will reject the reference.
      }
    }
  }
  return false
}

export function validateContentSecurityPolicy(
  relativePath,
  facts,
  policy,
  documentOrigin,
  { validatePolicyContract = true } = {},
) {
  const failures = []
  const required = [
    "default-src",
    "base-uri",
    "connect-src",
    "font-src",
    "form-action",
    "frame-ancestors",
    "frame-src",
    "img-src",
    "manifest-src",
    "media-src",
    "object-src",
    "script-src",
    "script-src-attr",
    "style-src",
    "style-src-attr",
    "style-src-elem",
    "worker-src",
  ]

  if (validatePolicyContract) {
    for (const directive of required) {
      if (!policy.directives.has(directive)) failures.push(`CSP is missing ${directive}`)
    }
    for (const directive of ["base-uri", "frame-ancestors", "object-src", "script-src-attr"]) {
      if (policySources(policy, directive).join(" ") !== "'none'") {
        failures.push(`CSP ${directive} must be 'none'`)
      }
    }
    const scriptSources = policySources(policy, "script-src")
    if (!scriptSources.includes("'self'")) failures.push("CSP script-src must allow 'self'")
    if (scriptSources.some((source) => ["'unsafe-inline'", "'unsafe-eval'"].includes(source))) {
      failures.push("CSP script-src must not allow unsafe inline scripts or eval")
    }
    if (policy.value.includes("'unsafe-eval'")) failures.push("CSP must not allow unsafe eval")
    for (const directive of ["style-src", "style-src-attr", "style-src-elem"]) {
      if (!policySources(policy, directive).includes("'unsafe-inline'")) {
        failures.push(`CSP ${directive} must cover generated and legacy presentation styles`)
      }
    }
  }

  if (facts.inlineExecutableScripts.length > 0) {
    failures.push(
      `${relativePath} has ${facts.inlineExecutableScripts.length} inline executable script(s)`,
    )
  }
  if (facts.inlineEventHandlers.length > 0) {
    failures.push(
      `${relativePath} has inline event handlers: ${facts.inlineEventHandlers.join(", ")}`,
    )
  }
  if (facts.javascriptUrls.length > 0) {
    failures.push(`${relativePath} has javascript URLs: ${facts.javascriptUrls.join(", ")}`)
  }
  if (
    facts.inlineStyleAttributes > 0 &&
    !policySources(policy, "style-src-attr").includes("'unsafe-inline'")
  ) {
    failures.push(`${relativePath} has inline style attributes not covered by CSP`)
  }
  if (
    facts.inlineStyleElements > 0 &&
    !policySources(policy, "style-src-elem").includes("'unsafe-inline'")
  ) {
    failures.push(`${relativePath} has inline style elements not covered by CSP`)
  }

  for (const resource of facts.cspReferences) {
    const sources = policySources(policy, resource.directive)
    if (!referenceAllowed(resource.value, documentOrigin, sources)) {
      failures.push(
        `${relativePath} ${resource.nodeName}.${resource.attribute} is blocked by ${resource.directive}: ${resource.value}`,
      )
    }
  }
  return failures
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

function structuredDataNodes(payloads) {
  return payloads.flatMap((payload) => [
    payload,
    ...(Array.isArray(payload?.["@graph"]) ? payload["@graph"] : []),
  ])
}

function hasStructuredType(payloads, type) {
  return structuredDataNodes(payloads).some((node) => {
    const value = node?.["@type"]
    return Array.isArray(value) ? value.includes(type) : value === type
  })
}

export function validateArticleSocialMetadata(relativePath, facts, manifestEntry) {
  const failures = []
  const image = facts.meta.get("og:image") ?? ""
  if (!manifestEntry) {
    failures.push(`${relativePath} article social image is missing from its manifest`)
    return failures
  }

  const expected = `https://markz.fun/static/${manifestEntry.path}`
  for (const key of ["og:image", "og:image:url", "og:image:secure_url", "twitter:image"]) {
    if (facts.meta.get(key) !== expected) {
      failures.push(`${relativePath} ${key} must be ${expected}`)
    }
  }
  if (image !== expected) failures.push(`${relativePath} has an unexpected article social image`)
  if (facts.meta.get("og:image:alt") !== manifestEntry.title) {
    failures.push(`${relativePath} social image alt must match the article title`)
  }
  if (facts.meta.get("og:image:type") !== "image/png") {
    failures.push(`${relativePath} article social image must declare image/png`)
  }
  if (facts.meta.get("og:image:width") !== "1200" || facts.meta.get("og:image:height") !== "630") {
    failures.push(`${relativePath} article social image must declare 1200x630`)
  }

  const article = structuredDataNodes(facts.structuredData).find(
    (node) => node?.["@type"] === "BlogPosting",
  )
  const structuredImages = Array.isArray(article?.image) ? article.image : [article?.image]
  if (!structuredImages.includes(expected)) {
    failures.push(`${relativePath} BlogPosting must use the same article social image`)
  }
  return failures
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
    if (!hasStructuredType(facts.structuredData, "BreadcrumbList")) {
      failures.push(`${relativePath} needs BreadcrumbList structured data`)
    }
    const articleNode = structuredDataNodes(facts.structuredData).find(
      (node) => node?.["@type"] === "BlogPosting",
    )
    const personNode = structuredDataNodes(facts.structuredData).find(
      (node) => node?.["@type"] === "Person",
    )
    if (!articleNode?.publisher) {
      failures.push(`${relativePath} BlogPosting needs publisher identity`)
    }
    if (personNode?.url !== "https://markz.fun/about") {
      failures.push(`${relativePath} Person identity must resolve to the visible author page`)
    }
    if (articleNode?.author?.["@id"] !== personNode?.["@id"]) {
      failures.push(`${relativePath} BlogPosting author must reference the declared Person`)
    }
    if (!facts.authorLinks.includes("/about")) {
      failures.push(`${relativePath} article needs a visible rel=author link to /about`)
    }
    for (const image of facts.images) {
      if (!image.alt.trim()) {
        failures.push(`${relativePath} content image needs descriptive alt text: ${image.src}`)
      }
    }
  } else if (facts.meta.get("og:type") !== "website") {
    failures.push(`${relativePath} must use the website Open Graph type`)
  }
  if (noindex && !facts.meta.get("robots")?.toLowerCase().includes("noindex")) {
    failures.push(`${relativePath} fallback content must be noindex`)
  }
  if (facts.fontStylesheets.length !== 0) {
    failures.push(`${relativePath} must not load remote Google Fonts stylesheets`)
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

async function validateGraphRuntime(root, outputRoot, outputId, jsFiles, failures) {
  const packageJson = await readJson(root, "package.json")
  const versions = {
    d3: packageJson.dependencies?.d3,
    pixi: packageJson.dependencies?.["pixi.js"],
  }
  const assetRoot = path.join(
    outputRoot,
    ...(outputId === "blog" ? ["notes", "static", "vendor"] : ["static", "vendor"]),
  )
  const assets = [`d3-graph-${versions.d3}.iife.min.js`, `pixi-graph-${versions.pixi}.iife.min.js`]

  for (const asset of assets) {
    try {
      await fs.access(path.join(assetRoot, asset))
    } catch {
      failures.push(`${outputId} output is missing self-hosted Graph runtime ${asset}`)
    }
  }

  const javascript = (
    await Promise.all(jsFiles.map(async (file) => fs.readFile(file, "utf8")))
  ).join("\n")
  if (/cdn\.jsdelivr\.net\/npm\/(?:d3|pixi\.js)@/i.test(javascript)) {
    failures.push(`${outputId} Graph runtime must not depend on jsDelivr`)
  }
  for (const asset of assets) {
    if (!javascript.includes(`static/vendor/${asset}`)) {
      failures.push(`${outputId} Graph loader is missing ${asset}`)
    }
  }
}

async function validateContentSecurityRuntime(root, outputRoot, outputId, jsFiles, failures) {
  const packageJson = await readJson(root, "package.json")
  const version = packageJson.dependencies?.["@mermaid-js/tiny"]
  const asset = `mermaid-tiny-${version}.esm.min.js`
  const assetPath = path.join(outputRoot, "static", "vendor", asset)
  try {
    const source = await fs.readFile(assetPath, "utf8")
    if (!source.includes("export { mermaid as default }")) {
      failures.push(`${outputId} Mermaid runtime must expose a local ESM default export`)
    }
  } catch {
    failures.push(`${outputId} output is missing self-hosted Mermaid runtime ${asset}`)
  }

  const javascriptEntries = await Promise.all(
    jsFiles.map(async (file) => ({ file, source: await fs.readFile(file, "utf8") })),
  )
  const javascript = javascriptEntries.map(({ source }) => source).join("\n")
  if (/cdnjs\.cloudflare\.com\/ajax\/libs\/mermaid/i.test(javascript)) {
    failures.push(`${outputId} Mermaid runtime must not depend on cdnjs`)
  }
  if (!javascript.includes(`/static/vendor/${asset}`)) {
    failures.push(`${outputId} Mermaid loader is missing ${asset}`)
  }
  for (const { file, source } of javascriptEntries) {
    const relative = path.relative(outputRoot, file).replaceAll(path.sep, "/")
    if (!relative.includes("static/vendor/") && /\bnew Function\s*\(/.test(source)) {
      failures.push(
        `${outputId} executable runtime uses dynamic function construction: ${relative}`,
      )
    }
  }
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

  try {
    const sitemap = await fs.readFile(path.join(outputRoot, "sitemap.xml"), "utf8")
    const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => ({
      location: match[1].match(/<loc>([^<]+)<\/loc>/)?.[1] ?? "",
      lastmod: match[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? "",
    }))
    const locations = entries.map((entry) => entry.location)
    if (locations.length === 0) failures.push(`${outputId} sitemap.xml must contain URLs`)
    for (const location of locations) {
      try {
        if (new URL(location).hostname !== host) {
          failures.push(`${outputId} sitemap contains a foreign host: ${location}`)
        }
      } catch {
        failures.push(`${outputId} sitemap contains an invalid URL: ${location}`)
      }
    }
    if (outputId === "blog") {
      for (const entry of entries) {
        let url
        try {
          url = new URL(entry.location)
        } catch {
          continue
        }
        if (!/^\/blog\/[^/]+$/.test(url.pathname)) continue
        const articleFile = path.join(
          outputRoot,
          `${decodeURIComponent(url.pathname.replace(/^\//, ""))}.html`,
        )
        try {
          const articleFacts = inspectHtml(await fs.readFile(articleFile, "utf8"))
          const article = structuredDataNodes(articleFacts.structuredData).find(
            (node) => node?.["@type"] === "BlogPosting",
          )
          if (!article?.dateModified || entry.lastmod !== article.dateModified) {
            failures.push(
              `${outputId} sitemap lastmod for ${entry.location} must match BlogPosting.dateModified`,
            )
          }
        } catch {
          failures.push(`${outputId} sitemap article is missing: ${entry.location}`)
        }
      }
    }
  } catch {
    failures.push(`${outputId} output is missing sitemap.xml`)
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
  const contentSecurityPolicy = await loadContentSecurityPolicy(root)
  failures.push(
    ...validateContentSecurityPolicy(
      "editorial CSP",
      inspectHtml("<!doctype html><html></html>"),
      contentSecurityPolicy,
      "https://markz.fun",
    ),
  )
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
    const cssSources = await Promise.all(cssFiles.map((file) => fs.readFile(file, "utf8")))
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
    await validateGraphRuntime(root, outputRoot, output.id, jsFiles, failures)
    await validateContentSecurityRuntime(root, outputRoot, output.id, jsFiles, failures)
    await validateDiscoveryFiles(outputRoot, output.id, failures)

    const indexFile = path.join(outputRoot, "index.html")
    let indexSource = ""
    try {
      indexSource = await fs.readFile(indexFile, "utf8")
    } catch {
      failures.push(`${output.id} output is missing index.html`)
    }
    failures.push(
      ...validateLegacyStylesheetCompatibility(
        inspectHtml(indexSource).stylesheets,
        cssSources,
      ).map((failure) => `${output.id} ${failure}`),
    )
    for (const snippet of [
      `data-brand-version="${tokens.version}"`,
      `markz-icon-${tokens.brand.assetRevision}.png`,
      `markz-card-${tokens.brand.assetRevision}.png`,
    ]) {
      if (!indexSource.includes(snippet)) failures.push(`${output.id} index is missing ${snippet}`)
    }

    const articleSocialEntries = new Map()
    const observedArticleSocialPaths = new Set()
    let articleSocialBytes = 0
    if (output.id === "blog") {
      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(outputRoot, "static/social/articles/manifest.json"), "utf8"),
        )
        if (manifest.width !== 1200 || manifest.height !== 630) {
          failures.push("article social image manifest must declare 1200x630")
        }
        if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
          failures.push("article social image manifest must contain editorial articles")
        }
        for (const entry of manifest.entries ?? []) {
          if (!/^social\/articles\/[a-z0-9-]+-[a-f0-9]{12}\.png$/.test(entry.path ?? "")) {
            failures.push(
              `article social image has an invalid content-addressed path: ${entry.path}`,
            )
            continue
          }
          if (!entry.title || !entry.hash || !entry.slug) {
            failures.push(`article social image manifest entry is incomplete: ${entry.path}`)
          }
          if (articleSocialEntries.has(entry.path)) {
            failures.push(`article social image manifest contains duplicate path ${entry.path}`)
          }
          articleSocialEntries.set(entry.path, entry)
        }
      } catch {
        failures.push("blog output is missing a valid article social image manifest")
      }
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
        if (facts.titleAuthority !== facts.title) {
          failures.push(`${relativePath} page title must match its independent title authority`)
        }
        const isNotesPage =
          output.id === "notes" ||
          outputRelativePath.startsWith("notes/") ||
          facts.canonical.startsWith("https://note.markz.fun/")
        const expectedSiteName = isNotesPage ? "MarkZ 公开笔记" : "MarkZ 个人博客"
        for (const name of ["application-name", "apple-mobile-web-app-title", "og:site_name"]) {
          if (facts.meta.get(name) !== expectedSiteName) {
            failures.push(`${relativePath} ${name} must identify ${expectedSiteName}`)
          }
        }
        if (/json\s*utils/i.test(facts.title)) {
          failures.push(`${relativePath} must not inherit the JSONUtils title`)
        }
        if (/json\s*utils/i.test(facts.meta.get("description") ?? "")) {
          failures.push(`${relativePath} must not inherit the JSONUtils description`)
        }
        if (output.id === "blog" && outputRelativePath === "index.html") {
          if (facts.meta.get("description") !== tokens.brand.description) {
            failures.push(`${relativePath} must use the governed blog description`)
          }
          if (!hasStructuredType(facts.structuredData, "Blog")) {
            failures.push(`${relativePath} needs Blog structured data`)
          }
          if (facts.h1Count !== 1) {
            failures.push(`${relativePath} blog home must contain exactly one h1`)
          }
        }
        if (output.id === "blog" && outputRelativePath === "about.html") {
          const profileNode = structuredDataNodes(facts.structuredData).find((node) => {
            const type = node?.["@type"]
            return Array.isArray(type) ? type.includes("ProfilePage") : type === "ProfilePage"
          })
          const personNode = structuredDataNodes(facts.structuredData).find(
            (node) => node?.["@type"] === "Person",
          )
          if (!profileNode || !personNode) {
            failures.push(
              `${relativePath} author page needs ProfilePage and Person structured data`,
            )
          }
          if (profileNode?.mainEntity?.["@id"] !== personNode?.["@id"]) {
            failures.push(`${relativePath} ProfilePage must identify the declared Person`)
          }
          if (facts.h1Count !== 1) {
            failures.push(`${relativePath} author page must contain exactly one h1`)
          }
        }
      }
      failures.push(
        ...validateContentSecurityPolicy(
          relativePath,
          facts,
          contentSecurityPolicy,
          output.id === "notes" ? "https://note.markz.fun" : "https://markz.fun",
          { validatePolicyContract: false },
        ),
      )
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
          if (article) {
            let socialPath = ""
            try {
              const imageUrl = new URL(facts.meta.get("og:image") ?? "")
              if (imageUrl.origin !== "https://markz.fun") {
                failures.push(`${relativePath} article social image must use the blog origin`)
              }
              socialPath = imageUrl.pathname.replace(/^\/static\//, "")
              if (!/^social\/articles\/[a-z0-9-]+-[a-f0-9]{12}\.png$/.test(socialPath)) {
                failures.push(`${relativePath} must use a content-addressed article social image`)
              }
            } catch {
              failures.push(`${relativePath} has an invalid article social image URL`)
            }

            const manifestEntry = articleSocialEntries.get(socialPath)
            failures.push(...validateArticleSocialMetadata(relativePath, facts, manifestEntry))
            if (manifestEntry && !observedArticleSocialPaths.has(socialPath)) {
              observedArticleSocialPaths.add(socialPath)
              const imageFile = path.join(outputRoot, "static", socialPath)
              try {
                const [stat, metadata] = await Promise.all([
                  fs.stat(imageFile),
                  sharp(imageFile).metadata(),
                ])
                articleSocialBytes += stat.size
                if (stat.size > output.maxSocialImageBytes) {
                  failures.push(
                    `${relativePath} social image budget exceeded: ${stat.size} > ${output.maxSocialImageBytes}`,
                  )
                }
                if (
                  metadata.format !== "png" ||
                  metadata.width !== 1200 ||
                  metadata.height !== 630
                ) {
                  failures.push(`${relativePath} social image file must be a 1200x630 PNG`)
                }
              } catch {
                failures.push(`${relativePath} article social image file is missing or unreadable`)
              }
            }
          }
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

    if (output.id === "blog") {
      for (const socialPath of articleSocialEntries.keys()) {
        if (!observedArticleSocialPaths.has(socialPath)) {
          failures.push(`article social image is not used by an editorial article: ${socialPath}`)
        }
      }
      if (articleSocialBytes > output.maxTotalSocialImageBytes) {
        failures.push(
          `blog social image budget exceeded: ${articleSocialBytes} > ${output.maxTotalSocialImageBytes}`,
        )
      }
      try {
        const socialImageRoot = path.join(outputRoot, "static/social/articles")
        const imageFiles = await listFiles(socialImageRoot, ".png")
        const expectedFiles = new Set(
          [...articleSocialEntries.keys()].map((socialPath) =>
            path.join(outputRoot, "static", socialPath),
          ),
        )
        for (const imageFile of imageFiles) {
          if (!expectedFiles.has(imageFile)) {
            failures.push(`blog output contains a stale article social image: ${imageFile}`)
          }
        }
        if (imageFiles.length !== expectedFiles.size) {
          failures.push(
            `blog output must contain one unique social image per article: ${imageFiles.length} files for ${expectedFiles.size} entries`,
          )
        }
      } catch {
        failures.push("blog output is missing article social image files")
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
    console.log("Built pages satisfy metadata, links, CSP, brand, runtime, and asset budgets.")
  }
}

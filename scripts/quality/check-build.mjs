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
  const facts = { lang: "", title: "", meta: new Map(), references: [] }

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
    }
    for (const name of ["href", "src"]) {
      if (attrs[name]) facts.references.push(attrs[name])
    }
    for (const child of node.childNodes ?? []) visit(child)
  }

  visit(document)
  return facts
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
    if (cssBytes > output.maxTotalCssBytes) {
      failures.push(`${output.id} CSS budget exceeded: ${cssBytes} > ${output.maxTotalCssBytes}`)
    }
    if (jsBytes > output.maxTotalJsBytes) {
      failures.push(`${output.id} JS budget exceeded: ${jsBytes} > ${output.maxTotalJsBytes}`)
    }

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
      if (!facts.lang.toLowerCase().startsWith("zh")) failures.push(`${relativePath} needs zh lang`)
      if (!facts.title) failures.push(`${relativePath} needs a title`)
      if (!facts.meta.get("description")) failures.push(`${relativePath} needs meta description`)
      if (!facts.meta.get("viewport")) failures.push(`${relativePath} needs viewport metadata`)
      if (facts.meta.get("og:image:type") === "image/.png") {
        failures.push(`${relativePath} contains an invalid image MIME type`)
      }
      if (source.includes("MarkZ Notes"))
        failures.push(`${relativePath} contains retired brand copy`)

      for (const reference of facts.references) {
        if (output.allowedExternalRoutes.includes(reference)) continue
        const candidates = referenceCandidates(outputRoot, htmlFile, reference)
        if (candidates.length > 0 && !(await existingCandidate(candidates))) {
          const outputRelativePath = path.relative(outputRoot, htmlFile).replaceAll(path.sep, "/")
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

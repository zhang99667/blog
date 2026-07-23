import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { slugifyFilePath } from "@quartz-community/utils"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { blogConfig } from "./blog.config.mjs"
import {
  articleSocialImageDescriptor,
  generateArticleSocialImages,
} from "./design-system/article-social-images.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const designTokens = JSON.parse(
  await fs.readFile(path.join(root, "design-system/tokens.json"), "utf8"),
)
const brand = designTokens.brand
const cacheDir = path.join(root, ".cache")
const noteDir = path.join(cacheDir, "note")
const contentRoot = path.join(root, "content")
const blogContentDir = path.join(contentRoot, "site")
const notesContentDir = path.join(contentRoot, "notes")
const manifestPath = path.join(cacheDir, "publish-manifest.json")
const reactionAliasesPath = path.join(cacheDir, "reaction-aliases.json")
const noteOrigin = "https://note.markz.fun"

const noteRepo = process.env.NOTE_REPO ?? "https://github.com/zhang99667/note.git"
const noteRepoPrecheckedOut = process.env.NOTE_REPO_PRECHECKED_OUT === "1"
const defaultCollections = new Map([
  ["AI", { slug: "ai", title: "AI 工程" }],
  ["Android", { slug: "android", title: "Android" }],
  ["网络", { slug: "network", title: "网络" }],
  ["硕士", { slug: "master", title: "硕士" }],
])
const configuredIncludeDirs = splitList(process.env.BLOG_INCLUDE_DIRS, [])
const excludeDirs = new Set(splitList(process.env.BLOG_EXCLUDE_DIRS, ["Tasks", "promotion docs"]))
const ignoredTopLevelDirs = new Set(["node_modules", "scripts"])
const allowedAssetExts = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".svg",
  ".webp",
])
const configuredPosts = new Map(
  (blogConfig.posts ?? []).map((post, index) => [
    normalizeRel(post.source),
    { ...post, order: index },
  ]),
)

function splitList(value, fallback) {
  if (!value) return fallback
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function resolveCollections(
  directoryNames,
  { includeDirs = [], excludedDirs = excludeDirs } = {},
) {
  const discovered = [...new Set(directoryNames.map((name) => String(name).trim()).filter(Boolean))]
  const sources =
    includeDirs.length > 0
      ? [...new Set(includeDirs)]
      : discovered
          .filter(
            (name) =>
              !name.startsWith(".") && !ignoredTopLevelDirs.has(name) && !excludedDirs.has(name),
          )
          .sort((left, right) => {
            const known = [...defaultCollections.keys()]
            const leftOrder = known.indexOf(left)
            const rightOrder = known.indexOf(right)
            if (leftOrder !== -1 || rightOrder !== -1) {
              if (leftOrder === -1) return 1
              if (rightOrder === -1) return -1
              return leftOrder - rightOrder
            }
            return left.localeCompare(right, "zh-CN")
          })
  const collections = sources.map((source) => {
    const defaults = defaultCollections.get(source)
    return {
      source,
      slug: defaults?.slug ?? slugifySegment(source),
      title: defaults?.title ?? source,
    }
  })
  const slugOwners = new Map()

  for (const collection of collections) {
    const owner = slugOwners.get(collection.slug)
    if (owner) {
      throw new Error(
        `Public note collection slug "${collection.slug}" is shared by "${owner}" and "${collection.source}"`,
      )
    }
    slugOwners.set(collection.slug, collection.source)
  }

  return collections
}

async function discoverCollections() {
  const entries = await fs.readdir(noteDir, { withFileTypes: true })
  return resolveCollections(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    { includeDirs: configuredIncludeDirs, excludedDirs: excludeDirs },
  )
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: root,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`)
  }
}

function read(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  }).trim()
}

async function pathExists(fp) {
  try {
    await fs.access(fp)
    return true
  } catch {
    return false
  }
}

function toPosix(fp) {
  return fp.split(path.sep).join("/")
}

function normalizeRel(rel) {
  return toPosix(rel).replace(/^\/+/, "")
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

export function stableReactionId(sourcePath) {
  const normalized = normalizeRel(sourcePath).normalize("NFC")
  return `v1/${hashBuffer(Buffer.from(`markz-content\0${normalized}`, "utf8"))}`
}

export function buildReactionAliases(records, { generatedAt, sourceCommit }) {
  return {
    version: 1,
    generatedAt,
    sourceCommit,
    pages: records
      .map((record) => ({
        id: record.reactionId,
        ...(record.reactionPreviousIds?.length > 0
          ? { previousIds: record.reactionPreviousIds }
          : {}),
        aliases: [
          { site: "notes", slug: slugifyFilePath(record.path) },
          ...(record.post ? [{ site: "blog", slug: `blog/${record.post.slug}` }] : []),
        ],
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }
}

export function shouldSkipRelative(rel) {
  const parts = rel.split("/")
  // 隐藏目录和文件是 Vault 的工作区数据或历史备份，不属于公开内容表面。
  // 即使其中的旧 Markdown 仍保留 publish 标记，也不能重新进入博客或笔记站。
  if (parts.some((part) => part.startsWith("."))) {
    return true
  }
  if (parts.some((part) => excludeDirs.has(part))) return true
  if (rel.includes(".bak")) return true
  if (rel.endsWith("progress.json")) return true
  return false
}

function isPublishableFile(rel) {
  const ext = path.extname(rel).toLowerCase()
  if (ext === ".md" || ext === ".canvas") return true
  return allowedAssetExts.has(ext)
}

function splitFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { data: {}, body: text, raw: "" }

  try {
    return {
      data: parseYaml(match[1]) ?? {},
      body: text.slice(match[0].length).trimStart(),
      raw: match[1],
    }
  } catch {
    return { data: {}, body: text.slice(match[0].length).trimStart(), raw: match[1] }
  }
}

function asBoolean(value) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return ["true", "yes", "1"].includes(value.toLowerCase())
  return false
}

function asString(value) {
  if (value == null) return undefined
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (Array.isArray(value)) return value.join(", ")
  return String(value).trim() || undefined
}

function asIsoTimestamp(value) {
  const text = asString(value)
  if (!text) return undefined
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString()
}

export function parseGitDateLog(output, sourcePaths) {
  const targets = new Set(sourcePaths.map(normalizeRel))
  const dates = new Map()
  let commitDate

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith("--MARKZ-COMMIT--")) {
      commitDate = asIsoTimestamp(line.slice("--MARKZ-COMMIT--".length))
      continue
    }
    if (!line || !commitDate) continue

    const sourcePath = normalizeRel(line)
    if (!targets.has(sourcePath)) continue
    const current = dates.get(sourcePath)
    dates.set(sourcePath, {
      createdAt: commitDate,
      modifiedAt: current?.modifiedAt ?? commitDate,
    })
  }

  return dates
}

export function resolveSourceDates(frontmatter, gitDates, stat) {
  const filesystemCreated =
    stat.birthtime instanceof Date && stat.birthtime.getTime() > 0
      ? stat.birthtime.toISOString()
      : stat.mtime.toISOString()
  const createdAt =
    asIsoTimestamp(frontmatter.date) ??
    asIsoTimestamp(frontmatter.created) ??
    asIsoTimestamp(frontmatter.createdAt) ??
    gitDates?.createdAt ??
    filesystemCreated
  const modifiedAt =
    asIsoTimestamp(frontmatter.modified) ??
    asIsoTimestamp(frontmatter.updated) ??
    asIsoTimestamp(frontmatter.updatedAt) ??
    gitDates?.modifiedAt ??
    stat.mtime.toISOString()
  return { createdAt, modifiedAt }
}

export function withStableDates(text, dates) {
  const { data, body, raw } = splitFrontmatter(text)
  const generated = {}
  if (!asString(data.created)) generated.created = dates.createdAt
  if (!asString(data.modified)) generated.modified = dates.modifiedAt
  if (Object.keys(generated).length === 0) return text

  const additions = stringifyYaml(generated).trimEnd()
  const existing = raw.trimEnd()
  return `---\n${existing}${existing ? "\n" : ""}${additions}\n---\n${body}`
}

function asArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function isPublicFrontmatter(fm) {
  return asBoolean(fm.publish) && !asBoolean(fm.draft) && !asBoolean(fm.private)
}

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

async function cloneOrPullNotes() {
  await fs.mkdir(cacheDir, { recursive: true })
  if (noteRepoPrecheckedOut) {
    if (!(await pathExists(path.join(noteDir, ".git")))) {
      throw new Error("NOTE_REPO_PRECHECKED_OUT=1 requires the note repository at .cache/note")
    }
    if (read("git", ["-C", noteDir, "rev-parse", "--is-shallow-repository"]) === "true") {
      throw new Error("The prechecked note repository requires full history (fetch-depth: 0)")
    }
    return
  }

  if (await pathExists(path.join(noteDir, ".git"))) {
    if (read("git", ["-C", noteDir, "rev-parse", "--is-shallow-repository"]) === "true") {
      run("git", ["-C", noteDir, "fetch", "--unshallow", "origin"])
    }
    run("git", ["-C", noteDir, "pull", "--ff-only"])
  } else {
    run("git", ["clone", noteRepo, noteDir])
  }
}

function loadGitDates(sourcePaths) {
  if (sourcePaths.length === 0) return new Map()
  const output = read(
    "git",
    [
      "-C",
      noteDir,
      "-c",
      "core.quotepath=false",
      "log",
      "--format=--MARKZ-COMMIT--%cI",
      "--name-only",
      "--diff-filter=AMR",
      "--",
      ...sourcePaths,
    ],
    { maxBuffer: 50 * 1024 * 1024 },
  )
  return parseGitDateLog(output, sourcePaths)
}

async function loadOldManifest() {
  if (!(await pathExists(manifestPath))) return { files: {} }
  return JSON.parse(await fs.readFile(manifestPath, "utf8"))
}

export function findStaleGeneratedPaths(oldFiles = {}, nextFiles = {}) {
  return Object.keys(oldFiles).filter((rel) => !nextFiles[rel])
}

async function cleanupGeneratedShell(includeDirs) {
  await fs.rm(blogContentDir, { recursive: true, force: true })

  // Remove files generated by the previous single-site layout.
  await fs.rm(path.join(contentRoot, "index.md"), { force: true })
  await fs.rm(path.join(contentRoot, "blog"), { recursive: true, force: true })
  await fs.rm(path.join(contentRoot, "ai-data"), { recursive: true, force: true })

  // Migration from the first notes-first layout.
  for (const legacy of new Set([...includeDirs, "AI", "ai", "Android", "网络"])) {
    await fs.rm(path.join(contentRoot, legacy), { recursive: true, force: true })
  }
}

async function syncContent() {
  const includeCollections = await discoverCollections()
  const includeDirs = includeCollections.map((collection) => collection.source)
  const oldManifest = await loadOldManifest()
  await fs.mkdir(contentRoot, { recursive: true })
  await fs.mkdir(notesContentDir, { recursive: true })
  await cleanupGeneratedShell(includeDirs)

  const files = {}
  const records = []
  let copied = 0
  let unchanged = 0
  let skippedPrivate = 0
  let skippedFolderIndex = 0
  const inputs = []
  const pendingNotes = []

  for (const collection of includeCollections) {
    const sourceRoot = path.join(noteDir, collection.source)
    if (!(await pathExists(sourceRoot))) continue

    for (const sourceFile of await walk(sourceRoot)) {
      const srcRel = normalizeRel(path.relative(noteDir, sourceFile))
      if (shouldSkipRelative(srcRel) || !isPublishableFile(srcRel)) continue

      const relInsideCollection = normalizeRel(path.relative(sourceRoot, sourceFile))
      inputs.push({
        collection,
        sourceFile,
        srcRel,
        destRel: normalizeRel(path.posix.join(collection.slug, relInsideCollection)),
        ext: path.extname(srcRel).toLowerCase(),
      })
    }
  }

  const assetLookup = createAssetLookup(inputs.filter((input) => allowedAssetExts.has(input.ext)))
  const gitDates = loadGitDates(
    inputs.filter((input) => input.ext === ".md").map((input) => input.srcRel),
  )

  for (const input of inputs) {
    const { collection, sourceFile, srcRel, destRel, ext } = input
    if (ext !== ".md") continue

    const sourceData = await fs.readFile(sourceFile)
    const sourceText = sourceData.toString("utf8")
    const { data: fm } = splitFrontmatter(sourceText)
    if (!isPublicFrontmatter(fm)) {
      skippedPrivate += 1
      continue
    }
    if (await isRedundantFolderIndex(sourceFile, srcRel, sourceText)) {
      skippedFolderIndex += 1
      continue
    }

    const stat = await fs.stat(sourceFile)
    const sourceDates = resolveSourceDates(fm, gitDates.get(srcRel), stat)
    const record = buildRecord(destRel, srcRel, collection, sourceText, sourceDates, "")
    records.push(record)
    pendingNotes.push({ input, sourceText, sourceDates, record })
  }

  const publicCollectionSlugs = new Set(records.map((record) => record.collection.slug))
  for (const input of inputs) {
    const { collection, sourceFile, srcRel, destRel, ext } = input
    if (ext === ".md" || !publicCollectionSlugs.has(collection.slug)) continue

    const outputData = await fs.readFile(sourceFile)
    const destFile = path.join(notesContentDir, destRel)
    const hash = hashBuffer(outputData)
    files[destRel] = {
      source: srcRel,
      hash,
      size: outputData.length,
      type: "asset",
    }

    if (oldManifest.files?.[destRel]?.hash === hash && (await pathExists(destFile))) {
      unchanged += 1
    } else {
      await fs.mkdir(path.dirname(destFile), { recursive: true })
      await fs.writeFile(destFile, outputData)
      copied += 1
    }
  }

  const noteLookup = createNoteLookup(records)
  for (const { input, sourceText, sourceDates, record } of pendingNotes) {
    const rewritten = rewritePublicNoteMarkdown(sourceText, input, noteLookup, assetLookup)
    const outputData = Buffer.from(withStableDates(rewritten, sourceDates), "utf8")
    const hash = hashBuffer(outputData)
    const destFile = path.join(notesContentDir, input.destRel)
    files[input.destRel] = {
      source: input.srcRel,
      hash,
      size: outputData.length,
      type: "note",
    }
    record.hash = hash

    if (oldManifest.files?.[input.destRel]?.hash === hash && (await pathExists(destFile))) {
      unchanged += 1
    } else {
      await fs.mkdir(path.dirname(destFile), { recursive: true })
      await fs.writeFile(destFile, outputData)
      copied += 1
    }
  }

  for (const oldRel of findStaleGeneratedPaths(oldManifest.files, files)) {
    await fs.rm(path.join(notesContentDir, oldRel), { force: true })
  }

  records.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"))
  const posts = records.filter((record) => record.post).sort(comparePostsByEditorialDate)
  const sourceCommit = read("git", ["-C", noteDir, "rev-parse", "HEAD"])
  const generatedAt = new Date().toISOString()
  const manifest = {
    generatedAt,
    source: {
      repo: noteRepo,
      commit: sourceCommit,
      includeDirs,
      excludeDirs: [...excludeDirs],
    },
    counts: {
      posts: posts.length,
      notes: records.length,
      files: Object.keys(files).length,
      copied,
      unchanged,
      skippedPrivate,
      skippedFolderIndex,
    },
    files,
  }

  await writeGeneratedPages(records, posts, manifest, assetLookup, includeCollections)
  await writeAiFiles(records, posts, manifest)
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await fs.writeFile(
    reactionAliasesPath,
    `${JSON.stringify(buildReactionAliases(records, { generatedAt, sourceCommit }), null, 2)}\n`,
  )

  console.log(
    `Synced ${posts.length} posts, ${records.length} notes and ${
      Object.keys(files).length - records.length
    } assets from ${sourceCommit.slice(0, 7)}. Copied ${copied}, unchanged ${unchanged}.`,
  )
}

async function isRedundantFolderIndex(sourceFile, srcRel, text) {
  if (path.basename(srcRel).toLowerCase() !== "index.md") return false
  const parentDir = path.dirname(sourceFile)
  const parentName = path.basename(parentDir)
  const sibling = path.join(parentDir, `${parentName}.md`)
  if (!(await pathExists(sibling))) return false
  return stripMarkdown(text).length < 220
}

function removeFrontmatter(text) {
  return splitFrontmatter(text).body
}

function stripMarkdown(text) {
  return removeFrontmatter(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, " ")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, "$2$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[#*_`>|~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractTitle(rel, text, fm) {
  const fmTitle = asString(fm.title)
  if (fmTitle) return stripMarkdown(fmTitle)
  const body = removeFrontmatter(text)
  const match = body.match(/^#\s+(.+)$/m)
  if (match) return stripMarkdown(match[1])
  return path.basename(rel, ".md")
}

function extractSummary(text, fm) {
  const fmSummary = asString(fm.summary) ?? asString(fm.description) ?? asString(fm.excerpt)
  if (fmSummary) return stripMarkdown(fmSummary).slice(0, 260)

  const body = removeFrontmatter(text).replace(/```[\s\S]*?```/g, "\n")
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  for (const paragraph of paragraphs) {
    if (/^(#|[-*]\s|\||>|!?\[\[)/.test(paragraph)) continue
    const cleaned = stripMarkdown(paragraph)
    if (cleaned.length >= 24) return cleaned.slice(0, 220)
  }

  return stripMarkdown(body).slice(0, 220)
}

function extractHeadings(text) {
  return [...removeFrontmatter(text).matchAll(/^(#{2,4})\s+(.+)$/gm)].slice(0, 12).map((match) => ({
    depth: match[1].length,
    text: stripMarkdown(match[2]).slice(0, 120),
  }))
}

function extractTags(text, fm) {
  const tags = new Set(asArray(fm.tags))
  for (const match of text.matchAll(/(^|\s)#([\p{L}\p{N}_/-]{2,})/gu)) {
    tags.add(match[2])
  }
  return [...tags].sort((a, b) => a.localeCompare(b, "zh-CN"))
}

function extractLinks(text) {
  const links = new Set()
  for (const match of text.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1].trim()
    if (
      !target ||
      target.includes("/img/") ||
      allowedAssetExts.has(path.extname(target).toLowerCase())
    ) {
      continue
    }
    links.add(target.replace(/\.md$/i, ""))
  }
  for (const match of text.matchAll(/\[[^\]]+]\(([^)]+\.md)\)/g)) {
    links.add(decodeURIComponent(match[1]).replace(/\.md$/i, ""))
  }
  return [...links].sort((a, b) => a.localeCompare(b, "zh-CN"))
}

export function classifyPost(sourceRel, fm) {
  const configured = configuredPosts.get(sourceRel)
  const type = asString(fm.type)?.toLowerCase()
  if (type !== "post") return undefined

  const title = asString(fm.title) ?? configured?.title
  return {
    slug: slugifySegment(
      asString(fm.slug) ?? configured?.slug ?? title ?? path.basename(sourceRel, ".md"),
    ),
    order: configured?.order ?? 1000,
    featured: configured?.featured ?? asBoolean(fm.featured),
  }
}

export function comparePostsByEditorialDate(a, b) {
  return (
    b.date.localeCompare(a.date) ||
    a.post.order - b.post.order ||
    a.path.localeCompare(b.path, "zh-CN")
  )
}

function buildRecord(destRel, sourceRel, collection, text, sourceDates, hash) {
  const { data: fm } = splitFrontmatter(text)
  const configured = configuredPosts.get(sourceRel)
  const plain = stripMarkdown(text)
  const title = asString(fm.title) ?? configured?.title ?? extractTitle(sourceRel, text, fm)
  const summary =
    asString(fm.summary) ??
    asString(fm.description) ??
    asString(fm.excerpt) ??
    configured?.summary ??
    extractSummary(text, fm)
  const date = sourceDates.createdAt.slice(0, 10)
  const post = classifyPost(sourceRel, fm)
  const id = destRel.replace(/\.md$/i, "")
  const reactionPreviousIds = Array.isArray(configured?.previousSources)
    ? configured.previousSources.map((previousSource) => stableReactionId(previousSource))
    : []

  return {
    id,
    sourcePath: sourceRel,
    path: destRel,
    url: `/${encodeURI(id)}`,
    title,
    summary,
    tags: extractTags(text, fm),
    headings: extractHeadings(text),
    links: extractLinks(text),
    wordCount: [...plain].length,
    date,
    createdAt: sourceDates.createdAt,
    updatedAt: sourceDates.modifiedAt,
    reactionId: stableReactionId(sourceRel),
    reactionPreviousIds,
    collection,
    post: post
      ? {
          ...post,
          url: `/blog/${encodeURI(post.slug)}`,
        }
      : undefined,
    hash,
    markdown: text,
    plainText: plain,
  }
}

function buildGraph(records) {
  const byTitle = new Map()
  const byPath = new Map()
  for (const record of records) {
    byTitle.set(record.title, record.id)
    byTitle.set(path.basename(record.id), record.id)
    byPath.set(record.id, record.id)
  }

  const edges = []
  for (const record of records) {
    for (const link of record.links) {
      const target = byTitle.get(link) ?? byPath.get(link)
      if (target) edges.push({ source: record.id, target })
    }
  }

  return {
    nodes: records.map((record) => ({
      id: record.id,
      title: record.title,
      url: record.post?.url ?? `${noteOrigin}${record.url}`,
      noteUrl: `${noteOrigin}${record.url}`,
      tags: record.tags,
      type: record.post ? "post" : "note",
    })),
    edges,
  }
}

function buildChunks(records) {
  const chunks = []
  for (const record of records) {
    const chars = [...record.plainText]
    const size = 900
    const overlap = 120
    for (let offset = 0; offset < chars.length; offset += size - overlap) {
      const chunkText = chars
        .slice(offset, offset + size)
        .join("")
        .trim()
      if (chunkText.length < 80) continue
      chunks.push({
        id: `${record.id}#${chunks.length + 1}`,
        note: record.id,
        title: record.title,
        url: record.post?.url ?? `${noteOrigin}${record.url}`,
        noteUrl: `${noteOrigin}${record.url}`,
        type: record.post ? "post" : "note",
        text: chunkText,
      })
    }
  }
  return chunks
}

async function writeGeneratedPages(records, posts, manifest, assetLookup, includeCollections) {
  await writeHome(posts)
  await writeBlogIndex(posts, manifest)
  await writeAbout(posts)
  await writeBlogPosts(posts, records, assetLookup)
  const socialImages = await generateArticleSocialImages(posts, { root, tokens: designTokens })
  await writeNotesIndex(records, manifest, includeCollections)
  console.log(
    `Article social cards: ${socialImages.generated} generated, ${socialImages.reused} reused, ${socialImages.removed} removed.`,
  )
}

async function writeAbout(posts) {
  const latestPosts = posts.slice(0, 3).map(renderPostRow).join("\n")
  const body = `---
title: 关于 MarkZ
description: MarkZ 是本博客与公开笔记的作者，持续记录 AI 开发、软件工具、系统设计和产品实践。
---

<div class="author-profile">
  <header class="author-profile-intro">
    <p class="eyebrow">About the author</p>
    <p>MarkZ 是本博客与公开笔记的作者，持续记录 AI 开发、软件工具、系统设计和产品实践。</p>
    <p>博客收录经过整理的长文；研究过程、参考资料和持续更新的工作记录保留在独立公开笔记库。内容以实际问题、实现过程和可验证证据为主，不用批量拼接的页面替代真实经验。</p>
  </header>

  <section aria-labelledby="author-topics">
    <h2 id="author-topics">主要写什么</h2>
    <ul class="author-topic-list">
      <li><strong>AI 工程</strong><span>Agent、MCP、Skills、插件与模型调用链路</span></li>
      <li><strong>软件工具</strong><span>开发工作台、自动化流程与可维护的工程实践</span></li>
      <li><strong>系统设计</strong><span>稳定边界、验证机制、部署与长期演进</span></li>
    </ul>
  </section>

  <section aria-labelledby="author-links">
    <h2 id="author-links">站内与公开身份</h2>
    <div class="author-link-grid">
      <a href="/blog/"><strong>文章归档</strong><span>阅读经过整理的长文</span></a>
      <a href="https://note.markz.fun/"><strong>公开笔记</strong><span>查看研究过程与资料网络</span></a>
      <a href="https://github.com/zhang99667" rel="me"><strong>GitHub</strong><span>核对公开代码与项目活动</span></a>
    </div>
  </section>

  <section aria-labelledby="author-latest">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Latest writing</p>
        <h2 id="author-latest">最近文章</h2>
      </div>
      <a href="/blog/">查看全部</a>
    </div>
    <div class="post-feed">
${latestPosts || "<p>还没有发布文章。</p>"}
    </div>
  </section>
</div>
`

  await fs.mkdir(blogContentDir, { recursive: true })
  await fs.writeFile(path.join(blogContentDir, "about.md"), body)
}

async function writeHome(posts) {
  const postRows = posts.map(renderPostRow).join("\n")

  const body = `---
title: ${brand.name}
description: ${JSON.stringify(brand.description)}
---

<div class="blog-home">
  <section class="home-writing">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Latest writing</p>
        <h1>最近文章</h1>
      </div>
    </div>
    <div class="post-feed">
${postRows || "<p>还没有发布文章。</p>"}
    </div>
  </section>
</div>
`

  await fs.mkdir(blogContentDir, { recursive: true })
  await fs.writeFile(path.join(blogContentDir, "index.md"), body)
}

async function writeBlogIndex(posts, manifest) {
  const postRows = posts.map(renderPostRow).join("\n")
  const body = `---
title: 文章
description: MarkZ 的文章归档。
---

<div class="blog-index">
  <header class="archive-intro">
    <p class="eyebrow">Writing archive</p>
    <h1>文章</h1>
    <p>经过整理的长文，按发布时间排列。相关资料与过程记录会链接到独立笔记库。</p>
  </header>

  <div class="archive-summary">
    <span>共 ${posts.length} 篇</span>
    <span>AI 工程 · Android · 系统设计</span>
  </div>

  <div class="post-feed archive-feed">
${postRows || "<p>还没有发布文章。</p>"}
  </div>

  <p class="sync-line">更新于 ${htmlEscape(manifest.generatedAt.slice(0, 10))}</p>
</div>
`

  await fs.mkdir(path.join(blogContentDir, "blog"), { recursive: true })
  await fs.writeFile(path.join(blogContentDir, "blog", "index.md"), body)
}

async function writeBlogPosts(posts, records, assetLookup) {
  const blogDir = path.join(blogContentDir, "blog")
  const noteLookup = createNoteLookup(records)
  await fs.mkdir(blogDir, { recursive: true })

  for (const post of posts) {
    const socialImage = articleSocialImageDescriptor(post, designTokens)
    const fm = [
      "---",
      `title: ${JSON.stringify(post.title)}`,
      `description: ${JSON.stringify(post.summary)}`,
      `date: ${JSON.stringify(post.date)}`,
      `created: ${JSON.stringify(post.createdAt)}`,
      `modified: ${JSON.stringify(post.updatedAt)}`,
      `socialImage: ${JSON.stringify(socialImage.path)}`,
      `sourceNote: ${JSON.stringify(`${noteOrigin}${post.url}`)}`,
      post.tags.length > 0 ? "tags:" : "tags: []",
      ...post.tags.map((tag) => `  - ${JSON.stringify(tag)}`),
      "---",
      "",
    ].join("\n")
    const body = rewriteBlogMarkdown(
      removeFrontmatter(post.markdown),
      post,
      noteLookup,
      assetLookup,
    )
    const related = renderRelatedReading(post, posts, records)
    const source = `\n\n<aside class="article-source">\n  <span>原始笔记</span>\n  <a href="${noteOrigin}${post.url}">在笔记库中查看</a>\n</aside>\n`
    await fs.writeFile(
      path.join(blogDir, `${post.post.slug}.md`),
      `${fm}${body.trimStart()}${related}${source}`,
    )
  }
}

async function writeNotesIndex(records, manifest, includeCollections) {
  const collectionStats = renderCollectionStats(records, includeCollections)
  const latest = [...records]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12)
    .map(renderNoteLine)
    .join("\n")
  const body = `---
title: Notes
description: 从 Obsidian 同步出来的公开笔记库。
---

<div class="site-section">
  <div class="section-intro">
    <p class="eyebrow">Notes</p>
    <h2>公开笔记库</h2>
    <p>这里保留笔记的网络结构、原始分类和增量同步结果。适合查资料、顺链接和看未整理成文章的材料。</p>
  </div>

  <div class="stat-grid wide">
${collectionStats}
  </div>

  <div class="home-panel compact">
    <div class="section-head">
      <p class="eyebrow">Recent</p>
      <h3>最近更新</h3>
    </div>
    <ul class="quiet-list">
${latest || "<li>还没有可发布笔记</li>"}
    </ul>
  </div>

  <p class="sync-line">共 ${records.length} 篇公开笔记 · 同步时间：${htmlEscape(
    manifest.generatedAt,
  )}</p>
</div>
`

  await fs.mkdir(notesContentDir, { recursive: true })
  await fs.writeFile(path.join(notesContentDir, "index.md"), body)
}

async function writeAiFiles(records, posts, manifest) {
  const aiDir = path.join(blogContentDir, "ai-data")
  await fs.mkdir(aiDir, { recursive: true })

  const publicRecords = records.map(({ plainText, markdown, ...record }) => ({
    ...record,
    canonicalUrl: record.post?.url ?? `${noteOrigin}${record.url}`,
    noteUrl: `${noteOrigin}${record.url}`,
  }))
  const publicPosts = posts.map(({ plainText, markdown, ...record }) => ({
    ...record,
    canonicalUrl: record.post.url,
  }))

  await fs.writeFile(
    path.join(aiDir, "index.json"),
    `${JSON.stringify({ records: publicRecords, posts: publicPosts }, null, 2)}\n`,
  )
  await fs.writeFile(
    path.join(aiDir, "graph.json"),
    `${JSON.stringify(buildGraph(records), null, 2)}\n`,
  )
  await fs.writeFile(
    path.join(aiDir, "chunks.json"),
    `${JSON.stringify({ chunks: buildChunks(records) }, null, 2)}\n`,
  )
  await fs.writeFile(path.join(aiDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

function normalizeAssetKey(value) {
  return normalizeRel(path.posix.normalize(String(value).normalize("NFKC"))).toLowerCase()
}

function createAssetLookup(inputs) {
  const bySource = new Map()
  const byDest = new Map()
  const byBasename = new Map()

  for (const input of inputs) {
    bySource.set(normalizeAssetKey(input.srcRel), input)
    byDest.set(normalizeAssetKey(input.destRel), input)

    const basename = normalizeAssetKey(path.posix.basename(input.srcRel))
    const matches = byBasename.get(basename) ?? []
    matches.push(input)
    byBasename.set(basename, matches)
  }

  return { bySource, byDest, byBasename }
}

function decodeAssetTarget(target) {
  const clean = target.trim().split("?")[0].split("#")[0]
  try {
    return decodeURI(clean)
  } catch {
    return clean
  }
}

function resolveAssetTarget(target, input, assetLookup) {
  const clean = decodeAssetTarget(target)
  const sourceCandidates = [
    path.posix.join(path.posix.dirname(input.srcRel), clean),
    path.posix.join(input.collection.source, clean),
    clean,
  ]
  for (const candidate of sourceCandidates) {
    const match = assetLookup.bySource.get(normalizeAssetKey(candidate))
    if (match) return match
  }

  const destCandidates = [
    path.posix.join(path.posix.dirname(input.destRel), clean),
    path.posix.join(input.collection.slug, clean),
    clean,
  ]
  for (const candidate of destCandidates) {
    const match = assetLookup.byDest.get(normalizeAssetKey(candidate))
    if (match) return match
  }

  const basenameMatches = assetLookup.byBasename.get(normalizeAssetKey(path.posix.basename(clean)))
  if (!basenameMatches) return undefined
  if (basenameMatches.length === 1) return basenameMatches[0]
  return basenameMatches.find((match) => match.collection.slug === input.collection.slug)
}

function rewriteNoteAssetTargets(markdown, input, assetLookup) {
  const renderImage = (asset, alt, options = "") => {
    const optionWidth = options.match(/\|(\d+)/)?.[1]
    const altWidth = alt.match(/\|(\d+)$/)?.[1]
    const width = optionWidth ?? altWidth
    const cleanAlt = alt.replace(/\|\d+$/, "")
    const widthAttr = width ? ` width="${width}"` : ""
    return `<img src="/${encodeURI(asset.destRel)}" alt="${htmlEscape(cleanAlt)}"${widthAttr} />`
  }

  return rewriteOutsideCode(markdown, (text) =>
    text
      .replace(
        /!\[\[([^|\]#]+)(#[^|\]]+)?(\|[^\]]+)?\]\]/g,
        (match, target, anchor = "", options = "") => {
          const asset = resolveAssetTarget(target, input, assetLookup)
          if (!asset) return shouldRewriteAssetTarget(target) ? "" : match
          return renderImage(asset, "", options)
        },
      )
      .replace(/!\[([^\]]*)]\((?!https?:|mailto:|#|\/)([^)]+)\)/g, (match, alt, target) => {
        const asset = resolveAssetTarget(target, input, assetLookup)
        if (!asset) return alt.trim() ? htmlEscape(alt.trim()) : ""
        return renderImage(asset, alt)
      }),
  )
}

export function createNoteLookup(records) {
  const lookup = new Map()
  for (const record of records) {
    const keys = [
      record.title,
      record.id,
      record.sourcePath.replace(/\.md$/i, ""),
      path.posix.basename(record.id),
      path.posix.basename(record.sourcePath, ".md"),
    ]
    for (const key of keys) {
      const normalized = normalizeLookupKey(key)
      const existing = lookup.get(normalized)
      if (!existing?.post || record.post) {
        lookup.set(normalized, record)
      }
    }
  }
  return lookup
}

function createFolderLookup(records) {
  const lookup = new Map()
  for (const record of records) {
    const sourceParts = record.sourcePath.replace(/\.md$/i, "").split("/")
    const destinationParts = record.id.split("/")
    const depth = Math.min(sourceParts.length, destinationParts.length)
    for (let index = 1; index < depth; index += 1) {
      const sourceFolder = sourceParts.slice(0, index).join("/")
      const destinationFolder = destinationParts.slice(0, index).join("/")
      const folder = {
        id: destinationFolder,
        title: destinationParts[index - 1],
        url: `/${encodeURI(destinationFolder)}`,
        folder: true,
      }
      for (const key of [
        sourceFolder,
        `${sourceFolder}/index`,
        destinationFolder,
        `${destinationFolder}/index`,
      ]) {
        lookup.set(normalizeLookupKey(key), folder)
      }
    }
  }
  return lookup
}

function decodeNoteTarget(target) {
  const clean = target.trim().split("?")[0]
  try {
    return decodeURI(clean)
  } catch {
    return clean
  }
}

function resolvePublishedTarget(target, input, noteLookup, folderLookup) {
  const clean = decodeNoteTarget(target).replace(/^\/+|\/+$/g, "")
  const candidates = [
    clean,
    path.posix.join(path.posix.dirname(input.srcRel), clean),
    path.posix.join(input.collection.source, clean),
    path.posix.join(path.posix.dirname(input.destRel), clean),
    path.posix.join(input.collection.slug, clean),
  ]
  for (const candidate of candidates) {
    const key = normalizeLookupKey(path.posix.normalize(candidate))
    const record = noteLookup.get(key)
    if (record) return record
    const folder = folderLookup.get(key)
    if (folder) return folder
  }
  return undefined
}

function publicWikiLink(target, label, anchor = "") {
  const cleanLabel = label.replace(/[\n\r|\]]/g, " ").trim()
  const cleanAnchor = anchor.replace(/^#/, "").trim()
  const fragment = cleanAnchor ? `#${cleanAnchor}` : ""
  return `[[${target.id}${fragment}|${cleanLabel || target.title}]]`
}

function localMarkdownTarget(target) {
  const clean = target.trim().replace(/^<|>$/g, "")
  if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/|\/)/i.test(clean)) return undefined
  const hashIndex = clean.indexOf("#")
  return {
    target: hashIndex === -1 ? clean : clean.slice(0, hashIndex),
    anchor: hashIndex === -1 ? "" : clean.slice(hashIndex + 1),
  }
}

export function rewritePublicNoteMarkdown(markdown, input, noteLookup, assetLookup) {
  const folderLookup = createFolderLookup([...new Set(noteLookup.values())])
  const withAssets = rewriteNoteAssetTargets(markdown, input, assetLookup)

  return rewriteOutsideCode(withAssets, (text) =>
    text
      .replace(
        /!\[\[([^|\]#]+)(?:#([^|\]]+))?(?:\|([^\]]+))?\]\]/g,
        (match, target, anchor = "", options = "") => {
          const published = resolvePublishedTarget(target, input, noteLookup, folderLookup)
          if (!published) return ""
          const fragment = anchor.trim() ? `#${anchor.trim()}` : ""
          const suffix = options.trim() ? `|${options.trim()}` : ""
          return `![[${published.id}${fragment}${suffix}]]`
        },
      )
      .replace(
        /(?<!!)\[\[([^|\]#]+)(?:#([^|\]]+))?(?:\|([^\]]+))?\]\]/g,
        (match, target, anchor = "", alias = "") => {
          const published = resolvePublishedTarget(target, input, noteLookup, folderLookup)
          const label = (alias || published?.title || target).trim()
          return published ? publicWikiLink(published, label, anchor) : label
        },
      )
      .replace(/(?<!!)\[([^\]]+)]\(([^)]+)\)/g, (match, label, rawTarget) => {
        const local = localMarkdownTarget(rawTarget)
        if (!local) return match

        const asset = resolveAssetTarget(local.target, input, assetLookup)
        if (asset) {
          const relative = path.posix.relative(path.posix.dirname(input.destRel), asset.destRel)
          const fragment = local.anchor ? `#${local.anchor}` : ""
          return `[${label}](${encodeURI(relative)}${fragment})`
        }

        const published = resolvePublishedTarget(local.target, input, noteLookup, folderLookup)
        return published ? publicWikiLink(published, label, local.anchor) : label
      }),
  )
}

function normalizeLookupKey(value) {
  return String(value).normalize("NFKC").replace(/\.md$/i, "").trim().toLowerCase()
}

function linkedPostIds(record, lookup) {
  const ids = new Set()
  for (const link of record.links ?? []) {
    const target = lookup.get(normalizeLookupKey(link))
    if (target?.post && target.id !== record.id) ids.add(target.id)
  }
  return ids
}

export function rankRelatedPosts(current, posts, records = posts, limit = 3) {
  const lookup = createNoteLookup(records)
  const outgoing = linkedPostIds(current, lookup)
  const currentTags = new Map(
    (current.tags ?? []).map((tag) => [normalizeLookupKey(tag), String(tag)]),
  )
  const cappedLimit = Math.min(3, Math.max(0, Math.floor(Number(limit) || 0)))

  return posts
    .filter((candidate) => candidate.post && candidate.id !== current.id)
    .map((candidate) => {
      const isOutgoing = outgoing.has(candidate.id)
      const isIncoming = linkedPostIds(candidate, lookup).has(current.id)
      const sharedTags = (candidate.tags ?? []).filter((tag) =>
        currentTags.has(normalizeLookupKey(tag)),
      )
      const sameCollection =
        Boolean(current.collection?.slug) && current.collection.slug === candidate.collection?.slug
      const score =
        (isOutgoing ? 100 : 0) +
        (isIncoming ? 60 : 0) +
        sharedTags.length * 20 +
        (sameCollection ? 12 : 0)

      if (score === 0) return undefined

      let reason
      if (isOutgoing) reason = "文中关联"
      else if (isIncoming) reason = "相关延伸"
      else if (sharedTags.length > 0) {
        reason = `共同主题 · ${currentTags.get(normalizeLookupKey(sharedTags[0]))}`
      } else {
        reason = `同属 ${candidate.collection.title}`
      }

      return { post: candidate, reason, score }
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Math.abs(a.post.post.order - current.post.order) -
          Math.abs(b.post.post.order - current.post.order) ||
        a.post.post.order - b.post.post.order ||
        a.post.title.localeCompare(b.post.title, "zh-CN"),
    )
    .slice(0, cappedLimit)
}

function renderRelatedReading(post, posts, records) {
  const related = rankRelatedPosts(post, posts, records)
  if (related.length === 0) return ""

  const id = `related-reading-${post.post.slug}`
  const rows = related
    .map(
      ({ post: relatedPost, reason }) => `    <li class="related-reading-item">
      <a href="${relatedPost.post.url}">
        <span class="related-reading-copy">
          <strong>${htmlEscape(relatedPost.title)}</strong>
          <span>${htmlEscape(relatedPost.summary)}</span>
        </span>
        <span class="related-reading-reason">${htmlEscape(reason)}</span>
        <span class="related-reading-arrow" aria-hidden="true">→</span>
      </a>
    </li>`,
    )
    .join("\n")

  return `\n\n<aside class="related-reading" data-related-reading aria-labelledby="${htmlEscape(id)}">
  <header class="related-reading-header">
    <p class="eyebrow">Related</p>
    <h2 id="${htmlEscape(id)}">继续阅读</h2>
  </header>
  <ol class="related-reading-list">
${rows}
  </ol>
</aside>\n`
}

function rewriteOutsideCode(markdown, transform) {
  let fenceChar
  return markdown
    .split("\n")
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
      if (fence) {
        if (!fenceChar) fenceChar = fence[0]
        else if (fence[0] === fenceChar) fenceChar = undefined
        return line
      }
      if (fenceChar) return line

      return line
        .split(/(`+[^`]*`+)/g)
        .map((part, index) => (index % 2 === 0 ? transform(part) : part))
        .join("")
    })
    .join("\n")
}

function rewriteBlogMarkdown(markdown, post, noteLookup, assetLookup) {
  const input = {
    srcRel: post.sourcePath,
    destRel: post.path,
    collection: post.collection,
  }
  return rewriteOutsideCode(markdown, (text) =>
    text
      .replace(
        /!\[\[([^|\]#]+)(#[^|\]]+)?(\|[^\]]+)?\]\]/g,
        (match, target, anchor = "", options = "") => {
          const cleanTarget = target.trim()
          if (!shouldRewriteAssetTarget(cleanTarget)) return match
          const asset = resolveAssetTarget(cleanTarget, input, assetLookup)
          if (!asset) return match
          const src = `${noteOrigin}/${encodeURI(asset.destRel)}`
          const width = options.match(/\|(\d+)/)?.[1]
          const widthAttr = width ? ` width="${width}"` : ""
          const alt = blogConfig.imageAlts?.[path.posix.basename(asset.destRel)] ?? ""
          return `<img src="${src}" alt="${htmlEscape(alt)}"${widthAttr} />`
        },
      )
      .replace(/!\[([^\]]*)]\((?!https?:|mailto:|#|\/)([^)]+)\)/g, (match, alt, target) => {
        if (!shouldRewriteAssetTarget(target)) return match
        const asset = resolveAssetTarget(target, input, assetLookup)
        if (!asset) return match
        return `![${alt}](${noteOrigin}/${encodeURI(asset.destRel)})`
      })
      .replace(
        /\[\[([^|\]#]+)(?:#([^|\]]+))?(?:\|([^\]]+))?\]\]/g,
        (match, target, anchor, alias) => {
          const record = noteLookup.get(normalizeLookupKey(target))
          const label = (alias ?? record?.title ?? target).trim()
          if (!record) return label

          const href =
            record.post && record.id !== post.id ? record.post.url : `${noteOrigin}${record.url}`
          const fragment = anchor ? `#${encodeURIComponent(anchor.trim())}` : ""
          return `[${label}](${href}${fragment})`
        },
      ),
  )
}

function shouldRewriteAssetTarget(target) {
  const clean = target.split("?")[0].split("#")[0]
  return clean.startsWith("img/") || allowedAssetExts.has(path.extname(clean).toLowerCase())
}

function renderPostRow(post) {
  return `      <article class="post-row">
        <a href="${post.post.url}">
          <div class="post-row-meta">
            <time datetime="${htmlEscape(post.date)}">${htmlEscape(post.date)}</time>
            <span>${htmlEscape(post.collection.title)}</span>
          </div>
          <div class="post-row-copy">
            <strong>${htmlEscape(post.title)}</strong>
            <p>${htmlEscape(post.summary)}</p>
          </div>
          <span class="post-row-arrow" aria-hidden="true">→</span>
        </a>
      </article>`
}

function renderNoteLine(record) {
  return `        <li><a href="${record.url}">${htmlEscape(record.title)}</a><span>${htmlEscape(
    record.collection.title,
  )}</span></li>`
}

function renderCollectionStats(records, includeCollections) {
  return includeCollections
    .map((collection) => {
      const count = records.filter((record) => record.collection.slug === collection.slug).length
      if (count === 0) return ""
      return `        <a class="stat-card" href="/${collection.slug}/">
          <strong>${count}</strong>
          <span>${htmlEscape(collection.title)}</span>
        </a>`
    })
    .filter(Boolean)
    .join("\n")
}

function slugifySegment(value) {
  const slug = String(value)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "post"
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  await cloneOrPullNotes()
  await syncContent()
}

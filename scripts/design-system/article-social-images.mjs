import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, "../..")

export const articleSocialImageContract = {
  version: "1.0.0",
  width: 1200,
  height: 630,
  maxTitleLines: 3,
  publicDirectory: "social/articles",
  cacheDirectory: ".cache/social-images",
  fonts: [
    {
      family: "MarkZ Social CJK",
      file: "design-system/fonts/noto-sans-sc-chinese-simplified-800-normal.woff",
      sha256: "dcb2e590d4ec4d6dee1004fcd333990ae5941511459c4d2a3238706689844826",
    },
    {
      family: "MarkZ Social Latin",
      file: "design-system/fonts/noto-sans-sc-latin-800-normal.woff",
      sha256: "6c462a676276dfb8987aaa9c6c332e58dbdd1b4e7d8fda9761e6a3a0adcc1865",
    },
  ],
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function normalizeArticle(post) {
  const rawSlug = String(post.post?.slug ?? post.slug ?? "article")
  const slug =
    rawSlug
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "article"

  return {
    slug,
    title: String(post.title ?? "Untitled").trim() || "Untitled",
    date: String(post.date ?? "").slice(0, 10),
    category: String(post.collection?.title ?? "文章").trim() || "文章",
  }
}

export function articleSocialImageDescriptor(post, tokens) {
  const article = normalizeArticle(post)
  const fingerprint = sha256(
    JSON.stringify({
      renderer: articleSocialImageContract.version,
      article,
      brand: {
        name: tokens.brand.name,
        domain: tokens.brand.domain,
        wordmarkWeight: tokens.brand.wordmarkWeight,
        dotScale: tokens.brand.dotScale,
      },
      colors: tokens.fixedColors,
      fonts: articleSocialImageContract.fonts.map(({ sha256: hash }) => hash),
    }),
  )

  return {
    ...article,
    hash: fingerprint,
    path: `${articleSocialImageContract.publicDirectory}/${article.slug}-${fingerprint.slice(0, 12)}.png`,
  }
}

function characterUnits(character) {
  if (/\s/u.test(character)) return 0.32
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) {
    return 1
  }
  if (/[A-Z]/.test(character)) return 0.68
  if (/[a-z0-9]/.test(character)) return 0.55
  if (/[,.;:'"!?+\-_/()[\]{}]/.test(character)) return 0.38
  return 0.62
}

export function textUnits(value) {
  return [...String(value)].reduce((total, character) => total + characterUnits(character), 0)
}

function truncateLine(value, maxUnits) {
  const ellipsis = "…"
  const characters = [...value.trimEnd()]
  while (characters.length > 0 && textUnits(`${characters.join("")}${ellipsis}`) > maxUnits) {
    characters.pop()
  }
  return `${characters.join("").trimEnd()}${ellipsis}`
}

export function wrapArticleTitle(
  title,
  fontSize,
  maxLines = articleSocialImageContract.maxTitleLines,
) {
  const maxUnits = 1040 / fontSize
  const tokens = String(title).match(/[A-Za-z0-9][A-Za-z0-9+./:_()\-]*(?:\s+|$)|\s+|./gu) ?? []
  const lines = []
  let line = ""

  function pushLine() {
    const value = line.trim()
    if (value) lines.push(value)
    line = ""
  }

  for (const token of tokens) {
    let remainder = line ? token : token.trimStart()
    if (!remainder) continue

    if (line && textUnits(`${line}${remainder}`) > maxUnits) pushLine()
    remainder = line ? remainder : remainder.trimStart()

    while (textUnits(remainder) > maxUnits) {
      const characters = [...remainder]
      let splitAt = 1
      while (
        splitAt < characters.length &&
        textUnits(characters.slice(0, splitAt + 1).join("")) <= maxUnits
      ) {
        splitAt += 1
      }
      line = characters.slice(0, splitAt).join("")
      pushLine()
      remainder = characters.slice(splitAt).join("").trimStart()
    }

    line += remainder
  }
  pushLine()

  if (lines.length <= maxLines) return lines
  return [...lines.slice(0, maxLines - 1), truncateLine(lines[maxLines - 1], maxUnits)]
}

export function articleTitleLayout(title) {
  const units = textUnits(title)
  const fontSize = units <= 12 ? 86 : units <= 20 ? 78 : units <= 30 ? 68 : 58
  const lines = wrapArticleTitle(title, fontSize)
  const lineHeight = Math.round(fontSize * 1.17)
  const firstBaseline = Math.round(335 - ((lines.length - 1) * lineHeight) / 2)
  return { fontSize, firstBaseline, lineHeight, lines }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function formatDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replaceAll("-", " / ") : "UNDATED"
}

export function renderArticleSocialCardSvg(post, tokens, fontData) {
  const article = normalizeArticle(post)
  const colors = tokens.fixedColors
  const layout = articleTitleLayout(article.title)
  const titleLines = layout.lines
    .map(
      (line, index) =>
        `  <text x="84" y="${layout.firstBaseline + index * layout.lineHeight}" fill="${colors.brandInk}" font-family="MarkZ Social CJK, MarkZ Social Latin" font-size="${layout.fontSize}" font-weight="800">${escapeXml(line)}</text>`,
    )
    .join("\n")

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${articleSocialImageContract.width}" height="${articleSocialImageContract.height}" viewBox="0 0 ${articleSocialImageContract.width} ${articleSocialImageContract.height}">
  <style>
    @font-face { font-family: "MarkZ Social CJK"; src: url(data:font/woff;base64,${fontData.cjk}) format("woff"); font-weight: 800; }
    @font-face { font-family: "MarkZ Social Latin"; src: url(data:font/woff;base64,${fontData.latin}) format("woff"); font-weight: 800; }
  </style>
  <rect width="1200" height="630" fill="${colors.brandSurface}"/>
  <text x="84" y="104" fill="${colors.brandInk}" font-family="MarkZ Social Latin" font-size="38" font-weight="800" textLength="116" lengthAdjust="spacingAndGlyphs">${escapeXml(tokens.brand.name)}</text>
  <circle cx="211" cy="96" r="6" fill="${colors.brandAccent}"/>
  <text x="1116" y="104" text-anchor="end" fill="${colors.brandMuted}" font-family="MarkZ Social CJK, MarkZ Social Latin" font-size="20" font-weight="800">ARTICLE · ${escapeXml(article.category)}</text>
  <line x1="84" y1="142" x2="1116" y2="142" stroke="${colors.brandLine}" stroke-width="2"/>
${titleLines}
  <line x1="84" y1="498" x2="1116" y2="498" stroke="${colors.brandLine}" stroke-width="2"/>
  <text x="84" y="552" fill="${colors.brandMuted}" font-family="MarkZ Social Latin" font-size="22" font-weight="800">${formatDate(article.date)}</text>
  <text x="1116" y="552" text-anchor="end" fill="${colors.brandMuted}" font-family="MarkZ Social Latin" font-size="22" font-weight="800">${escapeXml(tokens.brand.domain)}</text>
</svg>`
}

async function readFontData(root) {
  const [cjkSource, latinSource] = articleSocialImageContract.fonts
  const [cjk, latin] = await Promise.all([
    fs.readFile(path.join(root, cjkSource.file)),
    fs.readFile(path.join(root, latinSource.file)),
  ])
  for (const [source, buffer] of [
    [cjkSource, cjk],
    [latinSource, latin],
  ]) {
    const actual = sha256(buffer)
    if (actual !== source.sha256) {
      throw new Error(`${source.file} checksum mismatch: ${actual}`)
    }
  }
  return { cjk: cjk.toString("base64"), latin: latin.toString("base64") }
}

async function validImage(file) {
  try {
    const metadata = await sharp(file).metadata()
    return (
      metadata.format === "png" &&
      metadata.width === articleSocialImageContract.width &&
      metadata.height === articleSocialImageContract.height
    )
  } catch {
    return false
  }
}

export async function generateArticleSocialImages(posts, options = {}) {
  const root = options.root ?? defaultRoot
  const tokens =
    options.tokens ??
    JSON.parse(await fs.readFile(path.join(root, "design-system/tokens.json"), "utf8"))
  const fontData = await readFontData(root)
  const cacheRoot = path.join(root, articleSocialImageContract.cacheDirectory)
  const outputRoot = path.join(cacheRoot, articleSocialImageContract.publicDirectory)
  const entries = posts.map((post) => articleSocialImageDescriptor(post, tokens))
  const expectedFiles = new Set(entries.map((entry) => path.basename(entry.path)))
  let generated = 0
  let reused = 0
  let removed = 0

  await fs.mkdir(outputRoot, { recursive: true })
  for (const entry of await fs.readdir(outputRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".png") || expectedFiles.has(entry.name)) continue
    await fs.rm(path.join(outputRoot, entry.name))
    removed += 1
  }

  for (let index = 0; index < posts.length; index += 1) {
    const entry = entries[index]
    const target = path.join(cacheRoot, entry.path)
    if (await validImage(target)) {
      reused += 1
      continue
    }
    const svg = renderArticleSocialCardSvg(posts[index], tokens, fontData)
    await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(target)
    generated += 1
  }

  const manifest = {
    version: articleSocialImageContract.version,
    width: articleSocialImageContract.width,
    height: articleSocialImageContract.height,
    tokenVersion: tokens.version,
    assetRevision: tokens.brand.assetRevision,
    fonts: articleSocialImageContract.fonts.map(({ file, sha256: hash }) => ({
      file,
      sha256: hash,
    })),
    entries,
  }
  await fs.writeFile(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  return { generated, reused, removed, entries }
}

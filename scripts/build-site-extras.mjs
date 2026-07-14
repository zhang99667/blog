import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, "..")

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function cdata(value) {
  return String(value).replaceAll("]]>", "]]]]><![CDATA[>")
}

function validDate(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function publicationDate(post) {
  return validDate(post.date ? `${post.date}T00:00:00.000Z` : post.createdAt)
}

function editorialPosts(posts) {
  return posts
    .filter(
      (post) =>
        typeof post?.title === "string" &&
        typeof post?.summary === "string" &&
        typeof post?.post?.url === "string" &&
        /^\/blog\/[^/]+$/.test(post.post.url),
    )
    .sort((first, second) => {
      const firstDate = publicationDate(first)?.getTime() ?? 0
      const secondDate = publicationDate(second)?.getTime() ?? 0
      return secondDate - firstDate || first.title.localeCompare(second.title, "zh-CN")
    })
}

export function renderEditorialRss(posts, brand) {
  const origin = "https://markz.fun"
  const feedUrl = `${origin}/index.xml`
  const items = editorialPosts(posts)
  const latestModified = items
    .map((post) => validDate(post.updatedAt) ?? publicationDate(post))
    .filter(Boolean)
    .sort((first, second) => second.getTime() - first.getTime())[0]
  const body = items
    .map((post) => {
      const url = new URL(post.post.url, origin).toString()
      const published = publicationDate(post)
      const categories = [post.collection?.title, ...(post.tags ?? [])]
        .filter((value, index, all) => typeof value === "string" && all.indexOf(value) === index)
        .map((value) => `      <category>${xmlEscape(value)}</category>`)
        .join("\n")
      return `    <item>
      <title>${xmlEscape(post.title)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>
      <description><![CDATA[${cdata(post.summary)}]]></description>
${published ? `      <pubDate>${published.toUTCString()}</pubDate>\n` : ""}${categories ? `${categories}\n` : ""}    </item>`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(brand.name)}</title>
    <link>${origin}/</link>
    <description>${xmlEscape(brand.description)}</description>
    <language>zh-CN</language>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
${latestModified ? `    <lastBuildDate>${latestModified.toUTCString()}</lastBuildDate>\n` : ""}    <generator>MarkZ editorial feed</generator>
${body}
  </channel>
</rss>
`
}

export function renderRobotsTxt(sitemapUrl) {
  return `User-agent: *
Allow: /

Sitemap: ${sitemapUrl}
`
}

export async function writeSiteExtras({ root = defaultRoot, site, output }) {
  const outputRoot = path.resolve(root, output)
  await fs.mkdir(outputRoot, { recursive: true })

  if (site === "blog") {
    const [index, tokens] = await Promise.all([
      fs.readFile(path.join(root, "content/site/ai-data/index.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(root, "design-system/tokens.json"), "utf8").then(JSON.parse),
    ])
    await Promise.all([
      fs.writeFile(
        path.join(outputRoot, "index.xml"),
        renderEditorialRss(index.posts ?? [], {
          name: tokens.brand.name,
          description: tokens.brand.description,
        }),
      ),
      fs.writeFile(
        path.join(outputRoot, "robots.txt"),
        renderRobotsTxt("https://markz.fun/sitemap.xml"),
      ),
    ])
    return
  }

  if (site === "notes") {
    await fs.writeFile(
      path.join(outputRoot, "robots.txt"),
      renderRobotsTxt("https://note.markz.fun/sitemap.xml"),
    )
    return
  }

  throw new Error(`Unsupported site extras target: ${site}`)
}

function readOption(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const site = readOption("site")
  const output = readOption("output")
  if (!site || !output)
    throw new Error("Usage: build-site-extras.mjs --site <blog|notes> --output <dir>")
  await writeSiteExtras({ site, output })
  console.log(`Generated ${site} discovery files in ${output}.`)
}

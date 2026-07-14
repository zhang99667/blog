import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { renderEditorialRss, renderRobotsTxt, writeSiteExtras } from "./build-site-extras.mjs"

const posts = [
  {
    title: "Older & useful",
    summary: "A < B",
    date: "2026-06-01",
    updatedAt: "2026-06-02T00:00:00.000Z",
    tags: ["AI"],
    collection: { title: "工程" },
    post: { url: "/blog/older" },
  },
  {
    title: "Newest",
    summary: "Only an article.",
    date: "2026-07-01",
    updatedAt: "2026-07-03T00:00:00.000Z",
    collection: { title: "AI 工程" },
    post: { url: "/blog/newest" },
  },
  {
    title: "Archive page",
    summary: "Not an article.",
    date: "2026-08-01",
    post: { url: "/blog/" },
  },
]

test("editorial RSS contains only real posts in publication order", () => {
  const rss = renderEditorialRss(posts, { name: "MarkZ", description: "Personal blog" })
  assert.match(rss, /<title>MarkZ<\/title>/)
  assert.match(rss, /rel="self" type="application\/rss\+xml"/)
  assert.equal((rss.match(/<item>/g) ?? []).length, 2)
  assert.equal(rss.includes("Archive page"), false)
  assert.ok(rss.indexOf("Newest") < rss.indexOf("Older &amp; useful"))
  assert.match(rss, /<description><!\[CDATA\[A < B\]\]><\/description>/)
  assert.match(rss, /<category>AI 工程<\/category>/)
  assert.match(rss, /<lastBuildDate>Fri, 03 Jul 2026 00:00:00 GMT<\/lastBuildDate>/)
})

test("robots file declares the canonical sitemap", () => {
  assert.equal(
    renderRobotsTxt("https://markz.fun/sitemap.xml"),
    "User-agent: *\nAllow: /\n\nSitemap: https://markz.fun/sitemap.xml\n",
  )
})

test("site extras write independent blog and notes discovery files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "markz-site-extras-"))
  try {
    await fs.mkdir(path.join(root, "content/site/ai-data"), { recursive: true })
    await fs.mkdir(path.join(root, "design-system"), { recursive: true })
    await fs.writeFile(
      path.join(root, "content/site/ai-data/index.json"),
      JSON.stringify({ posts }),
    )
    await fs.writeFile(
      path.join(root, "design-system/tokens.json"),
      JSON.stringify({ brand: { name: "MarkZ", description: "Personal blog" } }),
    )

    await writeSiteExtras({ root, site: "blog", output: "public" })
    await writeSiteExtras({ root, site: "notes", output: "public-notes" })

    const rss = await fs.readFile(path.join(root, "public/index.xml"), "utf8")
    const blogRobots = await fs.readFile(path.join(root, "public/robots.txt"), "utf8")
    const notesRobots = await fs.readFile(path.join(root, "public-notes/robots.txt"), "utf8")
    assert.equal((rss.match(/<item>/g) ?? []).length, 2)
    assert.match(blogRobots, /https:\/\/markz\.fun\/sitemap\.xml/)
    assert.match(notesRobots, /https:\/\/note\.markz\.fun\/sitemap\.xml/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

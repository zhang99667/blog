import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import {
  expectedCanonicalUrl,
  inspectHtml,
  literalModuleReferences,
  maxInitialJavaScriptBytes,
  referenceCandidates,
  validateArticleSocialMetadata,
  validateHtmlMetadata,
  validateSeoMetadata,
} from "./check-build.mjs"

test("HTML inspection uses structured document data", () => {
  const facts = inspectHtml(
    `<!doctype html><html lang="zh-CN"><head><title>MarkZ</title><meta name="description" content="Blog"><meta property="og:image:type" content="image/png"></head><body><a href="/blog/hello">Hello</a></body></html>`,
  )
  assert.equal(facts.lang, "zh-CN")
  assert.equal(facts.title, "MarkZ")
  assert.equal(facts.meta.get("description"), "Blog")
  assert.deepEqual(facts.references, ["/blog/hello"])
})

test("SEO redirects use redirect metadata instead of content-page metadata", () => {
  const facts = inspectHtml(`<!doctype html>
    <html lang="en-us"><head>
      <title>Redirect</title>
      <link rel="canonical" href="../canonical">
      <meta name="robots" content="noindex">
      <meta http-equiv="refresh" content="0; url=../canonical">
    </head></html>`)

  assert.equal(facts.canonical, "../canonical")
  assert.equal(facts.refresh, "0; url=../canonical")
  assert.deepEqual(validateHtmlMetadata("redirect.html", facts), [])
})

test("SEO redirects require canonical and noindex metadata", () => {
  const facts = inspectHtml(
    `<!doctype html><html><head><title>Redirect</title><meta http-equiv="refresh" content="0; url=../canonical"></head></html>`,
  )

  assert.deepEqual(validateHtmlMetadata("redirect.html", facts), [
    "redirect.html redirect needs a canonical link",
    "redirect.html redirect needs noindex",
  ])
})

test("canonical URL expectations collapse index pages and deduplicate notes fallback", () => {
  assert.equal(expectedCanonicalUrl("blog", "index.html"), "https://markz.fun/")
  assert.equal(expectedCanonicalUrl("blog", "blog/index.html"), "https://markz.fun/blog/")
  assert.equal(
    expectedCanonicalUrl("blog", "notes/ai/agent-mcp.html"),
    "https://note.markz.fun/ai/agent-mcp",
  )
  assert.equal(
    expectedCanonicalUrl("notes", "ai/Agent MCP 完全指南.html"),
    "https://note.markz.fun/ai/Agent%20MCP%20%E5%AE%8C%E5%85%A8%E6%8C%87%E5%8D%97",
  )
})

test("article SEO contract requires canonical discovery, dates, JSON-LD, and one font source", () => {
  const facts = inspectHtml(`<!doctype html><html lang="zh-CN"><head>
    <title>Agent MCP</title>
    <meta name="description" content="MCP guide">
    <meta name="viewport" content="width=device-width">
    <meta property="og:type" content="article">
    <meta property="article:published_time" content="2026-07-07T00:00:00.000Z">
    <meta property="article:modified_time" content="2026-07-13T00:00:00.000Z">
    <link rel="canonical" href="https://markz.fun/blog/agent-mcp">
    <link rel="alternate" type="application/rss+xml" href="https://markz.fun/index.xml">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"BlogPosting"}]}</script>
  </head></html>`)

  assert.deepEqual(
    validateSeoMetadata("public/blog/agent-mcp.html", facts, {
      expectedCanonical: "https://markz.fun/blog/agent-mcp",
      expectedFeed: "https://markz.fun/index.xml",
      article: true,
    }),
    [],
  )
})

test("article social metadata uses one manifest-backed image across every discovery format", () => {
  const image = "https://markz.fun/static/social/articles/agent-mcp-a1b2c3d4e5f6.png"
  const facts = inspectHtml(`<!doctype html><html><head>
    <meta property="og:image" content="${image}">
    <meta property="og:image:url" content="${image}">
    <meta property="og:image:secure_url" content="${image}">
    <meta property="og:image:alt" content="Agent MCP 完全指南">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:image" content="${image}">
    <script type="application/ld+json">{"@graph":[{"@type":"BlogPosting","image":["${image}"]}]}</script>
  </head></html>`)

  assert.deepEqual(
    validateArticleSocialMetadata("public/blog/agent-mcp.html", facts, {
      path: "social/articles/agent-mcp-a1b2c3d4e5f6.png",
      title: "Agent MCP 完全指南",
    }),
    [],
  )
})

test("article social metadata rejects a generic or split-brain image", () => {
  const facts = inspectHtml(`<!doctype html><html><head>
    <meta property="og:image" content="https://markz.fun/static/markz-card-v2.png">
    <meta name="twitter:image" content="https://markz.fun/static/other.png">
    <script type="application/ld+json">{"@graph":[{"@type":"BlogPosting","image":["https://markz.fun/static/other.png"]}]}</script>
  </head></html>`)
  const failures = validateArticleSocialMetadata("public/blog/agent-mcp.html", facts, {
    path: "social/articles/agent-mcp-a1b2c3d4e5f6.png",
    title: "Agent MCP 完全指南",
  })

  assert.ok(failures.some((failure) => failure.includes("twitter:image")))
  assert.ok(failures.some((failure) => failure.includes("BlogPosting")))
  assert.ok(failures.some((failure) => failure.includes("1200x630")))
})

test("SEO contract rejects duplicate ungoverned font stylesheets", () => {
  const facts = inspectHtml(`<!doctype html><html><head>
    <meta property="og:type" content="website">
    <link rel="canonical" href="https://markz.fun/">
    <link rel="alternate" type="application/rss+xml" href="https://markz.fun/index.xml">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source%20Sans%20Pro">
    <script type="application/ld+json">{"@graph":[{"@type":"WebPage"}]}</script>
  </head></html>`)
  const failures = validateSeoMetadata("public/index.html", facts, {
    expectedCanonical: "https://markz.fun/",
    expectedFeed: "https://markz.fun/index.xml",
  })
  assert.ok(failures.some((failure) => failure.includes("exactly one")))
  assert.ok(failures.some((failure) => failure.includes("ungoverned fallback font")))
})

test("clean URL references map to file and directory candidates", () => {
  const candidates = referenceCandidates("/tmp/public", "/tmp/public/blog/index.html", "./post")
  assert.deepEqual(candidates, [
    path.resolve("/tmp/public/blog/post"),
    path.resolve("/tmp/public/blog/post.html"),
    path.resolve("/tmp/public/blog/post/index.html"),
  ])
})

test("dots in clean URL slugs do not suppress HTML candidates", () => {
  const candidates = referenceCandidates(
    "/tmp/public",
    "/tmp/public/android/index.html",
    "./view.post(runnable)",
  )
  assert.equal(candidates[1], path.resolve("/tmp/public/android/view.post(runnable).html"))
})

test("initial JS budget follows literal imports but excludes variable on-demand imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "markz-js-budget-"))
  const html = path.join(root, "index.html")
  const entry = 'await import("./eager.js"); const load = () => import(assetUrl)'
  const eager = "export const ready = true"

  try {
    await writeFile(html, '<script type="module" src="./entry.js"></script>')
    await writeFile(path.join(root, "entry.js"), entry)
    await writeFile(path.join(root, "eager.js"), eager)
    await writeFile(path.join(root, "on-demand.js"), "x".repeat(1000))

    assert.deepEqual(literalModuleReferences(entry), ["./eager.js"])
    assert.equal(
      await maxInitialJavaScriptBytes(root, [html]),
      Buffer.byteLength(entry) + Buffer.byteLength(eager),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

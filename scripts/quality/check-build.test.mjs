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
  publishedNoteReferenceCandidates,
  referenceCandidates,
  validateArticleSocialMetadata,
  validateContentSecurityPolicy,
  validateHtmlMetadata,
  validateLegacyStylesheetCompatibility,
  validateSeoMetadata,
} from "./check-build.mjs"
import {
  loadContentSecurityPolicy,
  parseContentSecurityPolicy,
} from "./content-security-policy.mjs"

test("HTML inspection uses structured document data", () => {
  const facts = inspectHtml(
    `<!doctype html><html lang="zh-CN"><head><title data-page-title="MarkZ">MarkZ</title><meta name="description" content="Blog"><meta property="og:image:type" content="image/png"></head><body><a href="/blog/hello">Hello</a></body></html>`,
  )
  assert.equal(facts.lang, "zh-CN")
  assert.equal(facts.title, "MarkZ")
  assert.equal(facts.titleAuthority, "MarkZ")
  assert.equal(facts.meta.get("description"), "Blog")
  assert.deepEqual(facts.references, ["/blog/hello"])
})

test("legacy browsers receive one compatibility-transformed CSS bundle", () => {
  assert.deepEqual(
    validateLegacyStylesheetCompatibility(
      ["../index-a1b2c3d4.css", "../static/resource-style-a1b2c3d4.css"],
      ["html{box-sizing:border-box}", ".page{display:grid}"],
    ),
    [],
  )
})

test("legacy CSS contract rejects split or untranslated required styles", () => {
  assert.deepEqual(
    validateLegacyStylesheetCompatibility(
      ["../index-a1b2c3d4.css", "../component-a1b2c3d4.css"],
      ["@layer quartz-base{html{box-sizing:border-box}}"],
    ),
    [
      "must bundle base, component, and custom styles before compatibility transform",
      "must not hide required styles inside the quartz-base cascade layer",
    ],
  )
})

test("legacy CSS contract requires core color fallbacks before color-mix enhancements", () => {
  assert.deepEqual(
    validateLegacyStylesheetCompatibility(
      ["../index-a1b2c3d4.css"],
      [
        ":root{--surface:var(--light);--surface-muted:var(--lightgray);--ink-soft:var(--darkgray);--line:var(--lightgray)}@supports (color:color-mix(in srgb,currentColor,transparent)){:root{--surface:color-mix(in srgb,var(--light) 90%,white 10%);--surface-muted:color-mix(in srgb,var(--light) 78%,var(--lightgray) 22%);--ink-soft:color-mix(in srgb,var(--darkgray) 78%,var(--gray) 22%);--line:color-mix(in srgb,var(--lightgray) 82%,var(--gray) 18%)}}",
      ],
    ),
    [],
  )

  assert.deepEqual(
    validateLegacyStylesheetCompatibility(
      ["../index-a1b2c3d4.css"],
      [":root{--line:color-mix(in srgb,var(--lightgray) 82%,var(--gray) 18%)}"],
    ),
    ["core color variable --line needs a legacy fallback before color-mix"],
  )
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

test("published note URLs resolve against canonical note build paths", () => {
  assert.deepEqual(
    publishedNoteReferenceCandidates(
      "/repo",
      "https://note.markz.fun/ai/codex-plugin-cc-rescue-%E5%8E%9F%E7%90%86",
    ),
    [
      "/repo/public-notes/ai/codex-plugin-cc-rescue-原理",
      "/repo/public-notes/ai/codex-plugin-cc-rescue-原理.html",
      "/repo/public-notes/ai/codex-plugin-cc-rescue-原理/index.html",
    ],
  )
  assert.deepEqual(publishedNoteReferenceCandidates("/repo", "https://example.com/ai/note"), [])
})

test("article SEO contract requires canonical discovery, dates, JSON-LD, and local fonts", () => {
  const facts = inspectHtml(`<!doctype html><html lang="zh-CN"><head>
    <title>Agent MCP</title>
    <meta name="description" content="MCP guide">
    <meta name="viewport" content="width=device-width">
    <meta property="og:type" content="article">
    <meta property="article:published_time" content="2026-07-07T00:00:00.000Z">
    <meta property="article:modified_time" content="2026-07-13T00:00:00.000Z">
    <link rel="canonical" href="https://markz.fun/blog/agent-mcp">
    <link rel="alternate" type="application/rss+xml" href="https://markz.fun/index.xml">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Person","@id":"https://markz.fun/#person","url":"https://markz.fun/about"},{"@type":"WebPage"},{"@type":"BreadcrumbList"},{"@type":"BlogPosting","author":{"@id":"https://markz.fun/#person"},"publisher":{"@id":"https://markz.fun/#person"}}]}</script>
  </head><body><a href="/about" rel="author">MarkZ</a><img src="diagram.svg" alt="MCP 调用流程"></body></html>`)

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

test("SEO contract rejects remote font stylesheets", () => {
  const facts = inspectHtml(`<!doctype html><html><head>
    <meta property="og:type" content="website">
    <link rel="canonical" href="https://markz.fun/">
    <link rel="alternate" type="application/rss+xml" href="https://markz.fun/index.xml">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source%20Sans%20Pro">
    <script type="application/ld+json">{"@graph":[{"@type":"WebPage"}]}</script>
  </head></html>`)
  const failures = validateSeoMetadata("public/index.html", facts, {
    expectedCanonical: "https://markz.fun/",
    expectedFeed: "https://markz.fun/index.xml",
  })
  assert.ok(failures.some((failure) => failure.includes("must not load remote Google Fonts")))
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

test("CSP validation accepts governed local, note-image, and structured-data resources", async () => {
  const policy = await loadContentSecurityPolicy()
  const facts = inspectHtml(`<!doctype html><html><head>
    <script src="/prescript.js"></script>
    <script type="application/ld+json">{"@type":"WebPage"}</script>
  </head><body style="color: black">
    <img src="data:image/png;base64,AA==">
    <img src="https://note.markz.fun/images/diagram.png">
  </body></html>`)

  assert.deepEqual(
    validateContentSecurityPolicy("public/index.html", facts, policy, "https://markz.fun"),
    [],
  )
})

test("CSP validation rejects inline execution and ungoverned origins", async () => {
  const policy = await loadContentSecurityPolicy()
  const facts = inspectHtml(`<!doctype html><html><head>
    <script>window.inline = true</script>
    <script src="https://example.com/app.js"></script>
  </head><body onclick="alert(1)"><a href="javascript:alert(1)">Bad</a></body></html>`)
  const failures = validateContentSecurityPolicy(
    "public/unsafe.html",
    facts,
    policy,
    "https://markz.fun",
  )

  assert.ok(failures.some((failure) => failure.includes("inline executable script")))
  assert.ok(failures.some((failure) => failure.includes("inline event handlers")))
  assert.ok(failures.some((failure) => failure.includes("javascript URLs")))
  assert.ok(failures.some((failure) => failure.includes("blocked by script-src")))
})

test("CSP validation rejects unsafe script policy drift", () => {
  const value =
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'self'; img-src 'self'; manifest-src 'self'; media-src 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src-attr 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline'; worker-src 'self'"
  const failures = validateContentSecurityPolicy(
    "policy",
    inspectHtml("<!doctype html><html></html>"),
    { value, directives: parseContentSecurityPolicy(value) },
    "https://markz.fun",
  )

  assert.ok(failures.some((failure) => failure.includes("script-src must not allow")))
  assert.ok(failures.some((failure) => failure.includes("must not allow unsafe eval")))
})

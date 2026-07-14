import assert from "node:assert/strict"
import test from "node:test"
import {
  canonicalPageUrl,
  canonicalSiteRootUrl,
  createStructuredData,
  isEditorialArticle,
  isNotesFallback,
  rssFeedUrl,
  serializeStructuredData,
} from "./seo"

test("SEO URLs use public clean routes and collapse index slugs", () => {
  assert.equal(canonicalPageUrl("markz.fun", "index", "index.md"), "https://markz.fun/")
  assert.equal(
    canonicalPageUrl("markz.fun", "blog/index", "blog/index.md"),
    "https://markz.fun/blog/",
  )
  assert.equal(
    canonicalPageUrl("markz.fun", "blog/agent-mcp", "blog/agent-mcp.md"),
    "https://markz.fun/blog/agent-mcp",
  )
  assert.equal(
    canonicalPageUrl("note.markz.fun", "ai/Agent MCP 完全指南", "ai/Agent MCP 完全指南.md"),
    "https://note.markz.fun/ai/Agent%20MCP%20%E5%AE%8C%E5%85%A8%E6%8C%87%E5%8D%97",
  )
})

test("notes fallback metadata points at the independent notes host", () => {
  assert.equal(canonicalSiteRootUrl("markz.fun/notes"), "https://note.markz.fun/")
  assert.equal(
    canonicalPageUrl("markz.fun/notes", "ai/agent-mcp", "ai/agent-mcp.md"),
    "https://note.markz.fun/ai/agent-mcp",
  )
  assert.equal(rssFeedUrl("markz.fun/notes"), "https://note.markz.fun/index.xml")
  assert.equal(isNotesFallback("markz.fun/notes"), true)
})

test("only canonical blog post routes are classified as editorial articles", () => {
  assert.equal(isEditorialArticle("markz.fun", "blog/agent-mcp"), true)
  assert.equal(isEditorialArticle("markz.fun", "blog/index"), false)
  assert.equal(isEditorialArticle("markz.fun/notes", "blog/agent-mcp"), false)
  assert.equal(isEditorialArticle("note.markz.fun", "ai/agent-mcp"), false)
})

test("structured data connects a BlogPosting to its page, author, and website", () => {
  const structured = createStructuredData({
    canonicalUrl: "https://markz.fun/blog/agent-mcp",
    title: "Agent MCP 完全指南",
    description: "理解 MCP。",
    imageUrl: "https://markz.fun/static/markz-card-v2.png",
    isArticle: true,
    publishedAt: "2026-07-07T00:00:00.000Z",
    modifiedAt: "2026-07-13T00:00:00.000Z",
    tags: ["AI 工程", "MCP"],
  })
  const graph = structured["@graph"] as Record<string, unknown>[]
  const article = graph.find((node) => node["@type"] === "BlogPosting")
  assert.ok(article)
  assert.equal(article.headline, "Agent MCP 完全指南")
  assert.equal(article.datePublished, "2026-07-07T00:00:00.000Z")
  assert.deepEqual(article.keywords, ["AI 工程", "MCP"])
  assert.deepEqual(article.mainEntityOfPage, {
    "@id": "https://markz.fun/blog/agent-mcp#webpage",
  })
})

test("structured data serialization cannot terminate its script element", () => {
  const serialized = serializeStructuredData({ value: "</script><script>alert(1)</script>" })
  assert.equal(serialized.includes("</script>"), false)
  assert.match(serialized, /\\u003c\/script>/)
})

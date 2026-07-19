import assert from "node:assert/strict"
import test from "node:test"
import {
  canonicalPageUrl,
  canonicalSiteName,
  canonicalSiteRootUrl,
  createStructuredData,
  isEditorialArticle,
  isNotesFallback,
  rssFeedUrl,
  serializeStructuredData,
  socialImageUrl,
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

test("site names keep blog and notes identities explicit", () => {
  assert.equal(canonicalSiteName("markz.fun"), "MarkZ 个人博客")
  assert.equal(canonicalSiteName("note.markz.fun"), "MarkZ 公开笔记")
  assert.equal(canonicalSiteName("markz.fun/notes"), "MarkZ 公开笔记")
  assert.equal(canonicalSiteName("example.com"), "MarkZ 个人博客")
})

test("only canonical blog post routes are classified as editorial articles", () => {
  assert.equal(isEditorialArticle("markz.fun", "blog/agent-mcp"), true)
  assert.equal(isEditorialArticle("markz.fun", "blog/index"), false)
  assert.equal(isEditorialArticle("markz.fun/notes", "blog/agent-mcp"), false)
  assert.equal(isEditorialArticle("note.markz.fun", "ai/agent-mcp"), false)
})

test("social images use article assets when present and preserve canonical host boundaries", () => {
  assert.equal(
    socialImageUrl("markz.fun", "social/articles/agent-mcp-a1b2c3d4e5f6.png", "fallback.png"),
    "https://markz.fun/static/social/articles/agent-mcp-a1b2c3d4e5f6.png",
  )
  assert.equal(
    socialImageUrl("markz.fun/notes", undefined, "markz-card-v2.png"),
    "https://note.markz.fun/static/markz-card-v2.png",
  )
  assert.equal(
    socialImageUrl("markz.fun", "https://images.example.com/card.png", "fallback.png"),
    "https://images.example.com/card.png",
  )
})

test("structured data connects a BlogPosting to the independent blog entity", () => {
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
  const website = graph.find((node) => node["@type"] === "WebSite")
  const blog = graph.find((node) => node["@type"] === "Blog")
  const person = graph.find((node) => node["@type"] === "Person")
  const breadcrumb = graph.find((node) => node["@type"] === "BreadcrumbList")
  const webPage = graph.find((node) => node["@type"] === "WebPage")
  const article = graph.find((node) => node["@type"] === "BlogPosting")
  assert.equal(website?.name, "MarkZ 个人博客")
  assert.equal(blog?.name, "MarkZ 个人博客")
  assert.deepEqual(person?.sameAs, ["https://github.com/zhang99667"])
  assert.equal(person?.url, "https://markz.fun/about")
  assert.deepEqual(webPage?.breadcrumb, {
    "@id": "https://markz.fun/blog/agent-mcp#breadcrumb",
  })
  assert.deepEqual(breadcrumb?.itemListElement, [
    {
      "@type": "ListItem",
      position: 1,
      name: "MarkZ",
      item: "https://markz.fun/",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "文章",
      item: "https://markz.fun/blog/",
    },
    {
      "@type": "ListItem",
      position: 3,
      name: "Agent MCP 完全指南",
      item: "https://markz.fun/blog/agent-mcp",
    },
  ])
  assert.ok(article)
  assert.equal(article.headline, "Agent MCP 完全指南")
  assert.equal(article.datePublished, "2026-07-07T00:00:00.000Z")
  assert.deepEqual(article.keywords, ["AI 工程", "MCP"])
  assert.deepEqual(article.mainEntityOfPage, {
    "@id": "https://markz.fun/blog/agent-mcp#webpage",
  })
  assert.deepEqual(article.isPartOf, { "@id": "https://markz.fun/#blog" })
  assert.deepEqual(article.publisher, { "@id": "https://markz.fun/#person" })
})

test("author page connects visible profile URL to the canonical Person entity", () => {
  const structured = createStructuredData({
    canonicalUrl: "https://markz.fun/about",
    title: "关于 MarkZ",
    description: "MarkZ 是本博客与公开笔记的作者。",
    imageUrl: "https://markz.fun/static/markz-card-v2.png",
    isArticle: false,
  })
  const graph = structured["@graph"] as Record<string, any>[]
  const profile = graph.find(
    (node) => Array.isArray(node["@type"]) && node["@type"].includes("ProfilePage"),
  )
  const person = graph.find((node) => node["@type"] === "Person")

  assert.ok(profile)
  assert.equal(profile.url, "https://markz.fun/about")
  assert.deepEqual(profile.mainEntity, { "@id": "https://markz.fun/#person" })
  assert.equal(person?.url, "https://markz.fun/about")
})

test("structured data serialization cannot terminate its script element", () => {
  const serialized = serializeStructuredData({ value: "</script><script>alert(1)</script>" })
  assert.equal(serialized.includes("</script>"), false)
  assert.match(serialized, /\\u003c\/script>/)
})

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { parse as parseYaml } from "yaml"
import {
  createNoteLookup,
  findStaleGeneratedPaths,
  isPublicFrontmatter,
  parseGitDateLog,
  rankRelatedPosts,
  resolveCollections,
  resolveSourceDates,
  rewritePublicNoteMarkdown,
  withStableDates,
} from "./sync-notes.mjs"

const checkoutStat = {
  birthtime: new Date("2026-07-13T08:00:00Z"),
  mtime: new Date("2026-07-13T08:00:00Z"),
}

function readFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/)
  return parseYaml(match?.[1] ?? "")
}

test("public note collections follow top-level Vault directories", () => {
  const collections = resolveCollections(
    ["硕士", "网络", "AI", "Android", "新分类", "Tasks", "promotion docs", ".obsidian", "scripts"],
    { excludedDirs: new Set(["Tasks", "promotion docs"]) },
  )

  assert.deepEqual(collections, [
    { source: "AI", slug: "ai", title: "AI 工程" },
    { source: "Android", slug: "android", title: "Android" },
    { source: "网络", slug: "network", title: "网络" },
    { source: "硕士", slug: "master", title: "硕士" },
    { source: "新分类", slug: "新分类", title: "新分类" },
  ])
})

test("collection and note renames replace old generated paths", () => {
  const before = resolveCollections(["硕士"])
  const after = resolveCollections(["master"])
  assert.equal(before[0].slug, "master")
  assert.equal(after[0].slug, "master")

  assert.deepEqual(
    findStaleGeneratedPaths(
      { "master/旧名字.md": { hash: "before" }, "master/img/keep.png": { hash: "asset" } },
      { "master/新名字.md": { hash: "after" }, "master/img/keep.png": { hash: "asset" } },
    ),
    ["master/旧名字.md"],
  )
})

test("automatic collection discovery rejects ambiguous public slugs", () => {
  assert.throws(
    () => resolveCollections(["网络", "network"]),
    /slug "network" is shared by "网络" and "network"/,
  )
})

test("public note sync requires an explicit publish marker", () => {
  assert.equal(isPublicFrontmatter({ publish: true }), true)
  assert.equal(isPublicFrontmatter({ publish: "yes" }), true)
  assert.equal(isPublicFrontmatter({}), false)
  assert.equal(isPublicFrontmatter({ publish: false }), false)
  assert.equal(isPublicFrontmatter({ publish: true, draft: true }), false)
  assert.equal(isPublicFrontmatter({ publish: true, private: true }), false)
})

test("Git history provides stable created and modified dates", () => {
  const dates = parseGitDateLog(
    [
      "--MARKZ-COMMIT--2025-06-01T10:00:00+08:00",
      "AI/示例.md",
      "--MARKZ-COMMIT--2024-01-02T09:00:00+08:00",
      "AI/示例.md",
      "Android/other.md",
    ].join("\n"),
    ["AI/示例.md"],
  )

  assert.deepEqual(dates.get("AI/示例.md"), {
    createdAt: "2024-01-02T01:00:00.000Z",
    modifiedAt: "2025-06-01T02:00:00.000Z",
  })
})

test("frontmatter wins, then Git history, never checkout time", () => {
  assert.deepEqual(
    resolveSourceDates(
      { created: "2023-05-06", updated: "2025-02-03" },
      { createdAt: "2020-01-01T00:00:00.000Z", modifiedAt: "2024-01-01T00:00:00.000Z" },
      checkoutStat,
    ),
    {
      createdAt: "2023-05-06T00:00:00.000Z",
      modifiedAt: "2025-02-03T00:00:00.000Z",
    },
  )

  assert.deepEqual(
    resolveSourceDates(
      {},
      { createdAt: "2020-01-01T00:00:00.000Z", modifiedAt: "2024-01-01T00:00:00.000Z" },
      checkoutStat,
    ),
    {
      createdAt: "2020-01-01T00:00:00.000Z",
      modifiedAt: "2024-01-01T00:00:00.000Z",
    },
  )
})

test("generated notes carry stable Quartz date frontmatter", () => {
  const markdown = withStableDates("---\ntitle: 示例\n---\n正文\n", {
    createdAt: "2020-01-01T00:00:00.000Z",
    modifiedAt: "2024-01-01T00:00:00.000Z",
  })

  assert.deepEqual(readFrontmatter(markdown), {
    title: "示例",
    created: "2020-01-01T00:00:00.000Z",
    modified: "2024-01-01T00:00:00.000Z",
  })
  assert.match(markdown, /---\n正文\n$/)
})

test("Quartz displays the editorial date and reads frontmatter before filesystem timestamps", () => {
  const config = parseYaml(readFileSync("quartz.config.yaml", "utf8"))
  const dates = config.plugins.find(
    (plugin) => plugin.source === "github:quartz-community/created-modified-date",
  )
  assert.equal(dates.options.defaultDateType, "created")
  assert.deepEqual(dates.options.priority, ["frontmatter", "filesystem"])
})

test("related posts favor real links and never include notes-only content", () => {
  const collection = { slug: "ai", title: "AI 工程" }
  const post = (id, order, options = {}) => ({
    id,
    title: options.title ?? id,
    summary: `${id} summary`,
    sourcePath: `AI/${id}.md`,
    links: options.links ?? [],
    tags: options.tags ?? [],
    collection: options.collection ?? collection,
    post: { order, slug: id, url: `/blog/${id}` },
  })
  const current = post("current", 4, { links: ["outgoing"], tags: ["MCP"] })
  const outgoing = post("outgoing", 8)
  const incoming = post("incoming", 1, { links: ["current"] })
  const tagged = post("tagged", 7, {
    tags: ["mcp"],
    collection: { slug: "network", title: "网络" },
  })
  const sameCollection = post("same-collection", 5)
  const extra = post("extra", 6)
  const noteOnly = {
    ...post("note-only", 2, { links: ["current"] }),
    post: undefined,
  }
  const posts = [current, outgoing, incoming, tagged, sameCollection, extra]

  const related = rankRelatedPosts(current, posts, [...posts, noteOnly], 99)

  assert.deepEqual(
    related.map(({ post: relatedPost }) => relatedPost.id),
    ["outgoing", "incoming", "tagged"],
  )
  assert.deepEqual(
    related.map(({ reason }) => reason),
    ["文中关联", "相关延伸", "共同主题 · MCP"],
  )
  assert.equal(related.length, 3)
  assert.equal(
    related.some(({ post: relatedPost }) => relatedPost.id === "note-only"),
    false,
  )
})

test("public note sync keeps resolvable links and deactivates private or missing targets", () => {
  const collection = { source: "Android", slug: "android", title: "Android" }
  const webView = {
    id: "android/Android基础/组件/WebView/WebView",
    sourcePath: "Android/Android基础/组件/WebView/WebView.md",
    title: "WebView",
    collection,
  }
  const input = {
    srcRel: "Android/方案/示例.md",
    destRel: "android/方案/示例.md",
    collection,
  }
  const markdown = [
    "关联 [[WebView]]、[[私有笔记|内部资料]]。",
    "[继续阅读](../Android基础/组件/WebView/WebView.md)",
    "![[img/未发布截图]]",
    "[原始报告](../img/未发布.html)",
  ].join("\n")

  const rewritten = rewritePublicNoteMarkdown(markdown, input, createNoteLookup([webView]), {
    bySource: new Map(),
    byDest: new Map(),
    byBasename: new Map(),
  })

  assert.match(rewritten, /\[\[android\/Android基础\/组件\/WebView\/WebView\|WebView]]/)
  assert.match(rewritten, /\[\[android\/Android基础\/组件\/WebView\/WebView\|继续阅读]]/)
  assert.match(rewritten, /内部资料/)
  assert.match(rewritten, /原始报告/)
  assert.doesNotMatch(rewritten, /私有笔记|未发布截图|未发布\.html/)
})

test("public note sync preserves valid folders, external links, and code examples", () => {
  const collection = { source: "Android", slug: "android", title: "Android" }
  const record = {
    id: "android/架构/设计模式/责任链模式",
    sourcePath: "Android/架构/设计模式/责任链模式.md",
    title: "责任链模式",
    collection,
  }
  const input = {
    srcRel: "Android/index.md",
    destRel: "android/index.md",
    collection,
  }
  const markdown = [
    "[架构](架构/) 与 [空目录](空目录/)",
    "[官网](https://example.com/docs)",
    "```md",
    "[[私有笔记]]",
    "```",
  ].join("\n")

  const rewritten = rewritePublicNoteMarkdown(markdown, input, createNoteLookup([record]), {
    bySource: new Map(),
    byDest: new Map(),
    byBasename: new Map(),
  })

  assert.match(rewritten, /\[\[android\/架构\|架构]]/)
  assert.match(rewritten, /空目录/)
  assert.doesNotMatch(rewritten, /\]\(空目录\//)
  assert.match(rewritten, /\[官网]\(https:\/\/example\.com\/docs\)/)
  assert.match(rewritten, /```md\n\[\[私有笔记]]\n```/)
})

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { parse as parseYaml } from "yaml"
import {
  parseGitDateLog,
  rankRelatedPosts,
  resolveSourceDates,
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

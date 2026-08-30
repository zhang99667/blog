import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { shouldRenderComments, type CommentVisibilityInput } from "./CommentVisibility"

function visible(overrides: Partial<CommentVisibilityInput> = {}): boolean {
  return shouldRenderComments({
    baseUrl: "note.markz.fun",
    slug: "ai/agent-mcp-完全指南",
    relativePath: "AI/Agent MCP 完全指南.md",
    ...overrides,
  })
}

describe("comment visibility", () => {
  test("shows comments on editorial blog posts and canonical Markdown notes", () => {
    assert.equal(
      visible({
        baseUrl: "markz.fun",
        slug: "blog/agent-skills",
        relativePath: "blog/agent-skills.md",
      }),
      true,
    )
    assert.equal(visible(), true)
  })

  test("keeps listings, site pages, folders, tags, and 404 pages quiet", () => {
    for (const input of [
      { baseUrl: "markz.fun", slug: "index", relativePath: "index.md" },
      { baseUrl: "markz.fun", slug: "blog/index", relativePath: "blog/index.md" },
      { baseUrl: "markz.fun", slug: "about", relativePath: "about.md" },
      { slug: "ai/index", relativePath: "AI/index.md" },
      { slug: "tags/ai", relativePath: "tags/ai.md" },
      { slug: "all-tags", relativePath: "all-tags.md" },
      { slug: "404", relativePath: "404.md" },
    ]) {
      assert.equal(visible(input), false, JSON.stringify(input))
    }
  })

  test("rejects fallback, Canvas, Bases, Excalidraw, and explicit opt-out pages", () => {
    for (const input of [
      { baseUrl: "markz.fun/notes" },
      { relativePath: "AI/board.canvas" },
      { relativePath: "AI/board.canvas.md" },
      { relativePath: "AI/catalog.base" },
      { relativePath: "AI/catalog.base.md" },
      { relativePath: "AI/diagram.excalidraw.md" },
      { comments: false },
      { comments: "false" },
    ]) {
      assert.equal(visible(input), false, JSON.stringify(input))
    }
  })

  test("does not let an explicit opt-in cross a governed page boundary", () => {
    assert.equal(
      visible({
        baseUrl: "markz.fun",
        slug: "about",
        relativePath: "about.md",
        comments: true,
      }),
      false,
    )
  })
})

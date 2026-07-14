import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { parse as parseYaml } from "yaml"
import { parseGitDateLog, resolveSourceDates, withStableDates } from "./sync-notes.mjs"

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

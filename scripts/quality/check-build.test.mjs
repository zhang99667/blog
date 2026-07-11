import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { inspectHtml, referenceCandidates } from "./check-build.mjs"

test("HTML inspection uses structured document data", () => {
  const facts = inspectHtml(
    `<!doctype html><html lang="zh-CN"><head><title>MarkZ</title><meta name="description" content="Blog"><meta property="og:image:type" content="image/png"></head><body><a href="/blog/hello">Hello</a></body></html>`,
  )
  assert.equal(facts.lang, "zh-CN")
  assert.equal(facts.title, "MarkZ")
  assert.equal(facts.meta.get("description"), "Blog")
  assert.deepEqual(facts.references, ["/blog/hello"])
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

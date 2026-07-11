import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { inspectHtml, referenceCandidates, validateHtmlMetadata } from "./check-build.mjs"

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

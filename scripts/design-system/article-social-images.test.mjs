import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import sharp from "sharp"
import {
  articleSocialImageContract,
  articleSocialImageDescriptor,
  articleTitleLayout,
  generateArticleSocialImages,
  renderArticleSocialCardSvg,
} from "./article-social-images.mjs"

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..")
const tokens = JSON.parse(
  await readFile(path.join(projectRoot, "design-system/tokens.json"), "utf8"),
)

function post(title = "Agent MCP 完全指南") {
  return {
    title,
    date: "2026-07-07",
    collection: { title: "AI 工程" },
    post: { slug: "agent-mcp" },
  }
}

test("article social image paths are deterministic and content addressed", () => {
  const first = articleSocialImageDescriptor(post(), tokens)
  const same = articleSocialImageDescriptor(post(), tokens)
  const changed = articleSocialImageDescriptor(post("Agent MCP 实战指南"), tokens)

  assert.deepEqual(first, same)
  assert.match(first.path, /^social\/articles\/agent-mcp-[a-f0-9]{12}\.png$/)
  assert.notEqual(first.path, changed.path)
})

test("long mixed-language titles stay within the governed line count", () => {
  const layout = articleTitleLayout(
    "Wrapper 包装层：用稳定入口隔开复杂世界，以及一段额外的超长标题验证和更多不会显示的补充说明，继续追加用于验证第三行截断的文字",
  )
  assert.ok(layout.lines.length <= articleSocialImageContract.maxTitleLines)
  assert.ok(layout.lines.at(-1).endsWith("…"))
  assert.ok(layout.fontSize >= 58)
})

test("social card SVG escapes article metadata and uses design tokens", () => {
  const svg = renderArticleSocialCardSvg(post("Agent <MCP> & 指南"), tokens, {
    cjk: "CJK_FONT",
    latin: "LATIN_FONT",
  })
  assert.match(svg, /Agent &lt;MCP&gt; &amp; 指南/)
  assert.match(svg, new RegExp(tokens.fixedColors.brandAccent))
  assert.match(svg, /ARTICLE · AI 工程/)
  assert.doesNotMatch(svg, /<MCP>/)
})

test("generator writes valid cards, reuses hashes, and removes stale images", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "markz-social-images-"))
  const fontRoot = path.join(root, "design-system/fonts")
  await mkdir(fontRoot, { recursive: true })
  for (const font of articleSocialImageContract.fonts) {
    await cp(path.join(projectRoot, font.file), path.join(root, font.file))
  }

  try {
    const first = await generateArticleSocialImages([post()], { root, tokens })
    const second = await generateArticleSocialImages([post()], { root, tokens })
    const changedPost = post("Agent MCP 实战指南")
    const third = await generateArticleSocialImages([changedPost], { root, tokens })
    const descriptor = articleSocialImageDescriptor(changedPost, tokens)
    const imagePath = path.join(root, articleSocialImageContract.cacheDirectory, descriptor.path)
    const metadata = await sharp(imagePath).metadata()
    const manifest = JSON.parse(
      await readFile(
        path.join(
          root,
          articleSocialImageContract.cacheDirectory,
          articleSocialImageContract.publicDirectory,
          "manifest.json",
        ),
        "utf8",
      ),
    )

    assert.equal(first.generated, 1)
    assert.equal(second.reused, 1)
    assert.equal(third.generated, 1)
    assert.equal(third.removed, 1)
    assert.equal(metadata.width, 1200)
    assert.equal(metadata.height, 630)
    assert.equal(metadata.format, "png")
    assert.deepEqual(manifest.entries, [descriptor])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

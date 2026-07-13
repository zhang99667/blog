import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const root = process.cwd()
const tokens = JSON.parse(readFileSync(path.join(root, "design-system/tokens.json"), "utf8"))
const manifest = JSON.parse(readFileSync(path.join(root, "design-system/manifest.json"), "utf8"))

function firstArticle(
  outputRoot: string,
  ignoredPrefixes: string[],
  accept: (html: string) => boolean = () => true,
) {
  const candidates: string[] = []
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.name.endsWith(".html")) candidates.push(target)
    }
  }
  visit(outputRoot)
  const selected = candidates
    .map((file) => path.relative(outputRoot, file).replaceAll(path.sep, "/"))
    .filter(
      (file) => file !== "index.html" && !ignoredPrefixes.some((prefix) => file.startsWith(prefix)),
    )
    // Linux also emits case-preserving SEO redirects; browser checks need a rendered article.
    .filter((file) => {
      const html = readFileSync(path.join(outputRoot, file), "utf8")
      return html.includes("<article") && accept(html)
    })
    .sort()[0]
  if (!selected) throw new Error(`No article page found in ${outputRoot}`)
  return `/${selected.replace(/\.html$/, "")}`
}

const pages = [
  { id: "blog-home", baseUrl: "http://127.0.0.1:4173", path: "/" },
  {
    id: "blog-article",
    baseUrl: "http://127.0.0.1:4173",
    path: `/blog${firstArticle(path.join(root, "public/blog"), ["index"])}`,
  },
  { id: "notes-home", baseUrl: "http://127.0.0.1:4174", path: "/" },
  {
    id: "notes-article",
    baseUrl: "http://127.0.0.1:4174",
    path: firstArticle(path.join(root, "public-notes"), ["404", "tags/", "all-tags"]),
  },
]

const hasArticleImage = (html: string) => /<article\b[\s\S]*?<img\b/.test(html)
const imagePages = [
  {
    id: "blog-image",
    baseUrl: "http://127.0.0.1:4173",
    path: `/blog${firstArticle(path.join(root, "public/blog"), [], hasArticleImage)}`,
  },
  {
    id: "notes-image",
    baseUrl: "http://127.0.0.1:4174",
    path: firstArticle(
      path.join(root, "public-notes"),
      ["404", "tags/", "all-tags"],
      hasArticleImage,
    ),
  },
]

const linkedGraphSlug = "ai/agent-mcp-完全指南"
const linkedGraphRoute = "/ai/agent-mcp-%E5%AE%8C%E5%85%A8%E6%8C%87%E5%8D%97"

async function mockReactions(page: Page, initialCount = 12) {
  const counts = new Map<string, number>()
  const visitors = new Map<string, Set<string>>()
  const writes: Array<{ site: string; slug: string; visitor: string }> = []

  await page.route("**/api/reactions**", async (route) => {
    const request = route.request()
    if (request.method() === "GET") {
      const url = new URL(request.url())
      const site = url.searchParams.get("site") ?? ""
      const slug = url.searchParams.get("slug") ?? ""
      const key = `${site}:${slug}`
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: counts.get(key) ?? initialCount }),
      })
      return
    }

    const body = request.postDataJSON() as { site: string; slug: string; visitor: string }
    const key = `${body.site}:${body.slug}`
    const pageVisitors = visitors.get(key) ?? new Set<string>()
    const added = !pageVisitors.has(body.visitor)
    if (added) pageVisitors.add(body.visitor)
    visitors.set(key, pageVisitors)
    counts.set(key, (counts.get(key) ?? initialCount) + (added ? 1 : 0))
    writes.push(body)
    await route.fulfill({
      status: added ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify({ count: counts.get(key), liked: true, added }),
    })
  })

  return { counts, writes }
}

for (const target of pages) {
  for (const viewport of manifest.requiredViewports) {
    for (const theme of manifest.requiredThemes) {
      test(`${target.id} ${viewport.name} ${theme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.addInitScript((savedTheme) => localStorage.setItem("theme", savedTheme), theme)
        const reactions = await mockReactions(page)
        await page.goto(`${target.baseUrl}${target.path}`, { waitUntil: "domcontentloaded" })
        await page.evaluate(() =>
          Promise.race([
            document.fonts.ready,
            new Promise((resolve) => window.setTimeout(resolve, 2_000)),
          ]),
        )
        await page.waitForFunction(
          () =>
            !document.querySelector(".explorer") ||
            Boolean(document.querySelector(".explorer-ul > li:not(.overflow-end)")),
        )
        await page.waitForFunction(
          () =>
            !document.querySelector(".explorer[aria-expanded], .explorer-content[aria-expanded]"),
        )
        await page.waitForFunction(() =>
          Array.from(document.images)
            .filter((image) => {
              const bounds = image.getBoundingClientRect()
              return bounds.bottom > 0 && bounds.top < window.innerHeight
            })
            .every((image) => image.complete && image.naturalWidth > 0),
        )
        await page.evaluate(async () => {
          const visibleImages = Array.from(document.images).filter((image) => {
            const bounds = image.getBoundingClientRect()
            return bounds.bottom > 0 && bounds.top < window.innerHeight
          })
          await Promise.all(visibleImages.map((image) => image.decode().catch(() => undefined)))
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          )
        })

        const brand = page.locator(".brand-mark").first()
        await expect(brand).toBeVisible()
        await expect(brand).toHaveAttribute("data-brand-version", tokens.version)
        const brandStyle = await brand.evaluate((element) => {
          const style = getComputedStyle(element)
          return { family: style.fontFamily, weight: style.fontWeight }
        })
        expect(brandStyle.family).toContain(tokens.brand.wordmarkFont)
        expect(brandStyle.weight).toBe(String(tokens.brand.wordmarkWeight))

        const documentState = await page.evaluate(() => ({
          lang: document.documentElement.lang,
          theme: document.documentElement.getAttribute("saved-theme"),
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          scrollY: window.scrollY,
          mainCount: document.querySelectorAll("main").length,
        }))
        expect(documentState.lang.toLowerCase()).toMatch(/^zh/)
        expect(documentState.theme).toBe(theme)
        expect(documentState.mainCount).toBe(1)
        expect(documentState.scrollWidth).toBeLessThanOrEqual(documentState.clientWidth + 1)
        expect(documentState.scrollY).toBeLessThanOrEqual(1)

        const vectorImage = page.locator('article img[src$=".svg"]').first()
        if ((await vectorImage.count()) > 0) {
          expect(await vectorImage.evaluate((image) => getComputedStyle(image).colorScheme)).toBe(
            "light",
          )
        }

        const overlap = await page.evaluate(() => {
          const brandElement = document.querySelector(".brand-mark")
          const header = brandElement?.closest("header")
          const sibling = header?.querySelector("nav, .search, .search-button")
          if (!(brandElement instanceof HTMLElement) || !(sibling instanceof HTMLElement)) return 0
          const first = brandElement.getBoundingClientRect()
          const second = sibling.getBoundingClientRect()
          if (first.width === 0 || second.width === 0) return 0
          return Math.max(
            0,
            Math.min(first.right, second.right) - Math.max(first.left, second.left),
          )
        })
        expect(overlap).toBe(0)

        const accessibility = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
        const violations = accessibility.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
          targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
        }))
        expect(violations).toEqual([])

        await testInfo.attach(`${target.id}-${viewport.name}-${theme}`, {
          body: await page.screenshot({ fullPage: false }),
          contentType: "image/png",
        })

        const reactionRoot = page.locator("[data-article-reaction]")
        if (target.id.endsWith("-article")) {
          await expect(reactionRoot).toHaveCount(1)
          await reactionRoot.scrollIntoViewIfNeeded()
          const reactionButton = reactionRoot.locator("button")
          await expect(reactionRoot).toHaveAttribute("aria-busy", "false")
          await expect(reactionButton).toBeEnabled()
          await expect(reactionButton).toHaveAttribute("aria-pressed", "false")
          await expect(reactionButton).toHaveAttribute("aria-disabled", "false")
          await expect(reactionButton.locator("[data-reaction-count]")).toHaveText("12")

          const bounds = await reactionButton.boundingBox()
          expect(bounds).not.toBeNull()
          expect(bounds!.width).toBeGreaterThanOrEqual(44)
          expect(bounds!.height).toBeGreaterThanOrEqual(44)
          expect(bounds!.x).toBeGreaterThanOrEqual(0)
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)

          await reactionButton.focus()
          await page.keyboard.press("Enter")
          await expect(reactionButton).toHaveAttribute("aria-pressed", "true")
          await expect(reactionButton).toHaveAttribute("aria-disabled", "true")
          await expect(reactionButton.locator("[data-reaction-label]")).toHaveText("已赞")
          await expect(reactionButton.locator("[data-reaction-count]")).toHaveText("13")
          await expect(reactionRoot.locator("[data-reaction-message]")).toHaveText("谢谢")
          expect(reactions.writes).toHaveLength(1)
          expect(reactions.writes[0]).toMatchObject({
            site: target.id.startsWith("blog") ? "blog" : "notes",
            slug: await page.locator("body").getAttribute("data-slug"),
          })
          expect(reactions.writes[0].visitor).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          )

          const reactionAccessibility = await new AxeBuilder({ page })
            .include("[data-article-reaction]")
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze()
          expect(
            reactionAccessibility.violations.map((violation) => ({
              id: violation.id,
              nodes: violation.nodes.length,
            })),
          ).toEqual([])

          await testInfo.attach(`${target.id}-reaction-${viewport.name}-${theme}`, {
            body: await page.screenshot({ fullPage: false }),
            contentType: "image/png",
          })
        } else {
          await expect(reactionRoot).toHaveCount(0)
        }
      })
    }
  }
}

test.describe("article reactions", () => {
  test("liked state survives reload and SPA navigation keeps page keys separate", async ({
    page,
  }) => {
    const mock = await mockReactions(page, 4)
    await page.goto(`${pages[1].baseUrl}${pages[1].path}`, { waitUntil: "domcontentloaded" })

    const button = page.locator("[data-article-reaction] button")
    await expect(button).toHaveAttribute("aria-pressed", "false")
    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "true")
    const firstSlug = await page.locator("body").getAttribute("data-slug")

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.locator("[data-article-reaction] button")).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(mock.writes).toHaveLength(1)

    await page.evaluate(() =>
      window.spaNavigate(new URL("/blog/macos-network-automount", location.href)),
    )
    await expect(page.locator("body")).toHaveAttribute("data-slug", "blog/macos-network-automount")
    await expect(page.locator("[data-article-reaction]")).toHaveCount(1)
    await expect(page.locator("[data-article-reaction] button")).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    expect(firstSlug).not.toBe("blog/macos-network-automount")
  })

  test("notes folder pages do not expose article reactions", async ({ page }) => {
    await mockReactions(page)
    await page.goto("http://127.0.0.1:4174/ai/", { waitUntil: "domcontentloaded" })
    await expect(page.locator(".page-listing")).toBeVisible()
    await expect(page.locator("[data-article-reaction]")).toHaveCount(0)
  })
})

test.describe("image lightbox", () => {
  test.describe.configure({ mode: "serial" })

  for (const target of imagePages) {
    for (const viewport of manifest.requiredViewports) {
      for (const theme of manifest.requiredThemes) {
        test(`${target.id} lightbox ${viewport.name} ${theme}`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          await page.addInitScript((savedTheme) => localStorage.setItem("theme", savedTheme), theme)
          await page.goto(`${target.baseUrl}${target.path}`, { waitUntil: "domcontentloaded" })

          const source = page.locator("article img[data-image-lightbox]").first()
          await expect(source).toBeVisible()
          await expect(source).toHaveAttribute("role", "button")
          await expect(source).toHaveAttribute("tabindex", "0")
          await expect(source).toHaveAttribute("aria-controls", "image-lightbox")
          expect(await source.evaluate((image) => image.closest("a") === null)).toBe(true)
          await expect
            .poll(() => source.evaluate((image) => image.complete && image.naturalWidth > 0))
            .toBe(true)

          await source.scrollIntoViewIfNeeded()
          await source.click()

          const dialog = page.locator("#image-lightbox.markz-image-lightbox")
          const preview = dialog.locator(
            '.pswp__item[aria-hidden="false"] .pswp__img:not(.pswp__img--placeholder)',
          )
          await expect(dialog).toBeVisible()
          await expect(dialog).toHaveAttribute("role", "dialog")
          await expect(dialog).toHaveAttribute("aria-label", "图片预览")
          await expect(preview).toBeVisible()
          await expect
            .poll(() => preview.evaluate((image) => image.complete && image.naturalWidth > 0))
            .toBe(true)
          await preview.evaluate(async (image) => {
            await image.decode()
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            )
          })
          await page.waitForTimeout(250)
          await expect
            .poll(() => dialog.evaluate((root) => root.contains(document.activeElement)))
            .toBe(true)

          const opened = await page.evaluate(() => {
            const dialog = document.querySelector<HTMLElement>("#image-lightbox")!
            const preview = dialog.querySelector<HTMLImageElement>(
              '.pswp__item[aria-hidden="false"] .pswp__img:not(.pswp__img--placeholder)',
            )!
            const bounds = dialog.getBoundingClientRect()
            const imageBounds = preview.getBoundingClientRect()
            const controls = [...dialog.querySelectorAll<HTMLElement>(".pswp__button")]
              .map((control) => control.getBoundingClientRect())
              .filter((control) => control.width > 0 && control.height > 0)
            return {
              dialogWidth: bounds.width,
              dialogHeight: bounds.height,
              imageWidth: imageBounds.width,
              imageHeight: imageBounds.height,
              controls,
              documentWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
            }
          })
          expect(opened.dialogWidth).toBeCloseTo(viewport.width, 0)
          expect(opened.dialogHeight).toBeCloseTo(viewport.height, 0)
          expect(opened.imageWidth).toBeLessThanOrEqual(viewport.width + 1)
          expect(opened.imageHeight).toBeLessThanOrEqual(viewport.height + 1)
          expect(opened.controls.length).toBeGreaterThanOrEqual(2)
          for (const control of opened.controls) {
            expect(control.width).toBeGreaterThanOrEqual(44)
            expect(control.height).toBeGreaterThanOrEqual(44)
            expect(control.top).toBeGreaterThanOrEqual(0)
            expect(control.right).toBeLessThanOrEqual(viewport.width)
            expect(control.bottom).toBeLessThanOrEqual(viewport.height)
            expect(control.left).toBeGreaterThanOrEqual(0)
          }
          expect(opened.documentWidth).toBeLessThanOrEqual(opened.clientWidth + 1)

          const accessibility = await new AxeBuilder({ page })
            .include("#image-lightbox")
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze()
          expect(
            accessibility.violations.map((violation) => ({
              id: violation.id,
              nodes: violation.nodes.length,
            })),
          ).toEqual([])

          await testInfo.attach(`${target.id}-lightbox-${viewport.name}-${theme}`, {
            body: await page.screenshot({ fullPage: false }),
            contentType: "image/png",
          })

          const initialWidth = await preview.evaluate(
            (image) => image.getBoundingClientRect().width,
          )
          const zoom = dialog.locator(".pswp__button--zoom")
          await expect(zoom).toBeVisible()
          await zoom.click()
          await expect(dialog).toHaveClass(/pswp--zoomed-in/)
          await expect
            .poll(() => preview.evaluate((image) => image.getBoundingClientRect().width))
            .toBeGreaterThan(initialWidth * 1.15)
          if (viewport.name === "desktop" && theme === "light") {
            await testInfo.attach(`${target.id}-lightbox-zoomed`, {
              body: await page.screenshot({ fullPage: false }),
              contentType: "image/png",
            })
          }

          await zoom.click()
          await expect(dialog).not.toHaveClass(/pswp--zoomed-in/)
          await page.mouse.click(4, viewport.height - 4)
          await expect(dialog).toHaveCount(0)
          expect(await source.evaluate((image) => document.activeElement === image)).toBe(true)

          await source.press("Enter")
          await expect(page.locator("#image-lightbox.markz-image-lightbox")).toBeVisible()
          await page.keyboard.press("Escape")
          await expect(page.locator("#image-lightbox")).toHaveCount(0)
          expect(await source.evaluate((image) => document.activeElement === image)).toBe(true)
        })
      }
    }
  }

  test("blog image lightbox survives SPA navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${imagePages[0].baseUrl}${imagePages[0].path}`, {
      waitUntil: "domcontentloaded",
    })
    await expect(page.locator("article img[data-image-lightbox]").first()).toBeVisible()

    await page.evaluate(() =>
      window.spaNavigate(new URL("/blog/macos-network-automount", location.href)),
    )
    await expect(page.locator("body")).toHaveAttribute("data-slug", "blog/macos-network-automount")
    await expect(page.locator("#image-lightbox")).toHaveCount(0)
    const navigatedImage = page.locator("article img[data-image-lightbox]").first()
    await expect(navigatedImage).toBeVisible()
    await navigatedImage.click()
    const dialog = page.locator("#image-lightbox")
    const preview = dialog.locator(
      '.pswp__item[aria-hidden="false"] .pswp__img:not(.pswp__img--placeholder)',
    )
    await expect(dialog).toBeVisible()
    await expect(preview).toHaveAttribute("src", /macos-network-automount-layers\.png/)
    await expect(preview).not.toHaveAttribute("data-vector", "true")
    await dialog.locator(".pswp__button--close").click()
    await expect(dialog).toHaveCount(0)
  })

  test("notes images form a keyboard-navigable PhotoSwipe gallery", async ({ page }) => {
    test.skip(
      !existsSync(path.join(root, "public-notes", `${linkedGraphSlug}.html`)),
      "The private note fixture is only available in publishing builds",
    )

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`http://127.0.0.1:4174${linkedGraphRoute}`, {
      waitUntil: "domcontentloaded",
    })

    const sources = page.locator("article img[data-image-lightbox]")
    expect(await sources.count()).toBeGreaterThan(1)
    await sources.first().scrollIntoViewIfNeeded()
    await sources.first().click()

    const dialog = page.locator("#image-lightbox")
    const current = dialog.locator(
      '.pswp__item[aria-hidden="false"] .pswp__img:not(.pswp__img--placeholder)',
    )
    await expect(current).toBeVisible()
    const firstSource = await current.getAttribute("src")
    await page.keyboard.press("ArrowRight")
    await expect.poll(() => current.getAttribute("src")).not.toBe(firstSource)
    await expect(dialog.locator(".pswp__counter")).toContainText("2 /")
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
  })
})

for (const viewport of manifest.requiredViewports) {
  for (const theme of manifest.requiredThemes) {
    test(`notes linked graph ${viewport.name} ${theme}`, async ({ page }, testInfo) => {
      test.skip(
        !existsSync(path.join(root, "public-notes", `${linkedGraphSlug}.html`)),
        "The private note fixture is only available in publishing builds",
      )

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.addInitScript((savedTheme) => localStorage.setItem("theme", savedTheme), theme)
      await page.goto(`http://127.0.0.1:4174${linkedGraphRoute}`, {
        waitUntil: "domcontentloaded",
      })

      await expect(page.locator("body")).toHaveAttribute("data-slug", linkedGraphSlug)
      const neighbourhood = await page.evaluate(async (slug) => {
        const response = await fetch("/static/contentIndex.json")
        const index = (await response.json()) as Record<string, { links?: string[] }>
        const edges: Array<{ source: string; target: string }> = []
        for (const [source, entry] of Object.entries(index)) {
          for (const target of entry.links ?? []) {
            if (source === slug || target === slug) edges.push({ source, target })
          }
        }
        return {
          edges: edges.length,
          nodes: new Set(edges.flatMap(({ source, target }) => [source, target])).size,
          outgoing: index[slug]?.links?.length ?? 0,
        }
      }, linkedGraphSlug)

      expect(neighbourhood.outgoing).toBeGreaterThanOrEqual(4)
      expect(neighbourhood.edges).toBeGreaterThanOrEqual(4)
      expect(neighbourhood.nodes).toBeGreaterThanOrEqual(5)

      const graphCanvas = page.locator(".graph-container canvas")
      await expect(graphCanvas).toHaveCount(1, { timeout: 20_000 })
      await expect(graphCanvas).toBeVisible()

      await expect
        .poll(
          async () => {
            return page.evaluate(() => JSON.parse(localStorage.getItem("graph-visited") ?? "[]"))
          },
          { timeout: 20_000 },
        )
        .toContain(linkedGraphSlug)

      const visited = await page.evaluate(
        () => JSON.parse(localStorage.getItem("graph-visited") ?? "[]") as string[],
      )
      expect(visited.some((slug) => slug.includes("%E5"))).toBe(false)

      await testInfo.attach(`notes-linked-graph-${viewport.name}-${theme}`, {
        body: await page.locator(".graph-outer").screenshot(),
        contentType: "image/png",
      })
    })
  }
}

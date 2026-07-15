import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const root = process.cwd()
const tokens = JSON.parse(readFileSync(path.join(root, "design-system/tokens.json"), "utf8"))
const manifest = JSON.parse(readFileSync(path.join(root, "design-system/manifest.json"), "utf8"))

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & {
      __markzCspViolations?: Array<Record<string, string | number>>
    }
    state.__markzCspViolations = []
    document.addEventListener("securitypolicyviolation", (event) => {
      state.__markzCspViolations?.push({
        effectiveDirective: event.effectiveDirective,
        blockedURI: event.blockedURI,
        disposition: event.disposition,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
      })
    })
  })
})

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return
  await page
    .evaluate(() => document.dispatchEvent(new CustomEvent("prenav")))
    .catch(() => undefined)
  await page.waitForTimeout(50).catch(() => undefined)
  const violations = await page
    .evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __markzCspViolations?: Array<Record<string, string | number>>
          }
        ).__markzCspViolations ?? [],
    )
    .catch(() => [])
  expect(violations, `Content Security Policy violations: ${JSON.stringify(violations)}`).toEqual(
    [],
  )
})

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

async function mockReactions(page: Page, initialLikes = 12, initialViews = 32) {
  const initialTodayVisitors = 7
  const initialTotalVisitors = 127
  const likeCounts = new Map<string, number>()
  const viewCounts = new Map<string, number>()
  const likeVisitors = new Map<string, Set<string>>()
  const viewVisitors = new Map<string, Set<string>>()
  const likeWrites: Array<{ site: string; slug: string; visitor: string }> = []
  const viewWrites: Array<{ site: string; slug: string; visitor: string }> = []
  const visitorOrdinals = new Map<string, number>()
  const visitorWrites: Array<{ visitor: string }> = []

  await page.route("**/api/visitors", async (route) => {
    const request = route.request()
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          date: "2026-07-14",
          todayVisitors: initialTodayVisitors + visitorOrdinals.size,
          totalVisitors: initialTotalVisitors + visitorOrdinals.size,
        }),
      })
      return
    }

    const body = request.postDataJSON() as { visitor: string }
    let todayOrdinal = visitorOrdinals.get(body.visitor)
    const added = todayOrdinal === undefined
    if (added) {
      todayOrdinal = initialTodayVisitors + visitorOrdinals.size + 1
      visitorOrdinals.set(body.visitor, todayOrdinal)
    }
    visitorWrites.push(body)
    await route.fulfill({
      status: added ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify({
        date: "2026-07-14",
        todayOrdinal,
        todayVisitors: initialTodayVisitors + visitorOrdinals.size,
        totalVisitors: initialTotalVisitors + visitorOrdinals.size,
        addedToday: added,
        addedTotal: added,
      }),
    })
  })

  await page.route("**/api/reactions**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === "GET") {
      const site = url.searchParams.get("site") ?? ""
      const slug = url.searchParams.get("slug") ?? ""
      const key = `${site}:${slug}`
      const likes = likeCounts.get(key) ?? initialLikes
      const views = viewCounts.get(key) ?? initialViews
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: likes, likes, views }),
      })
      return
    }

    const body = request.postDataJSON() as { site: string; slug: string; visitor: string }
    const key = `${body.site}:${body.slug}`
    if (url.pathname.endsWith("/view")) {
      const pageVisitors = viewVisitors.get(key) ?? new Set<string>()
      const added = !pageVisitors.has(body.visitor)
      if (added) pageVisitors.add(body.visitor)
      viewVisitors.set(key, pageVisitors)
      viewCounts.set(key, (viewCounts.get(key) ?? initialViews) + (added ? 1 : 0))
      viewWrites.push(body)
      await route.fulfill({
        status: added ? 201 : 200,
        contentType: "application/json",
        body: JSON.stringify({
          likes: likeCounts.get(key) ?? initialLikes,
          views: viewCounts.get(key),
          added,
        }),
      })
      return
    }

    const pageVisitors = likeVisitors.get(key) ?? new Set<string>()
    const added = !pageVisitors.has(body.visitor)
    if (added) pageVisitors.add(body.visitor)
    likeVisitors.set(key, pageVisitors)
    likeCounts.set(key, (likeCounts.get(key) ?? initialLikes) + (added ? 1 : 0))
    likeWrites.push(body)
    await route.fulfill({
      status: added ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify({
        count: likeCounts.get(key),
        likes: likeCounts.get(key),
        views: viewCounts.get(key) ?? initialViews,
        liked: true,
        added,
      }),
    })
  })

  return { likeCounts, viewCounts, likeWrites, viewWrites, visitorWrites }
}

for (const target of pages) {
  for (const viewport of manifest.requiredViewports) {
    for (const theme of manifest.requiredThemes) {
      test(`${target.id} ${viewport.name} ${theme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.addInitScript((savedTheme) => localStorage.setItem("theme", savedTheme), theme)
        const reactions = await mockReactions(page)
        await page.goto(`${target.baseUrl}${target.path}`, { waitUntil: "domcontentloaded" })
        const expectedTitleSuffix = target.id.startsWith("blog") ? " · 个人博客" : " · 公开笔记"
        const browserTitle = await page.title()
        expect(browserTitle).not.toMatch(/json\s*utils/i)
        expect(browserTitle.endsWith(expectedTitleSuffix)).toBe(true)
        await expect(page.locator("head title")).toHaveAttribute("data-page-title", browserTitle)
        await expect(page.locator('meta[name="application-name"]')).toHaveAttribute(
          "content",
          "MarkZ",
        )
        await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
          "content",
          "MarkZ",
        )
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

        if (target.id.startsWith("notes") && viewport.width <= 800) {
          await expect
            .poll(
              () =>
                page
                  .locator(".explorer-content")
                  .first()
                  .evaluate((element) => element.getBoundingClientRect().right),
              { timeout: 2_000 },
            )
            .toBeLessThanOrEqual(1)
        }

        const brand = page.locator(".brand-mark").first()
        await expect(brand).toBeVisible()
        await expect(brand).toHaveAttribute("data-brand-version", tokens.version)
        if (target.id.startsWith("blog")) {
          await expect(
            page.locator('.blog-nav a[href="https://zhangjihao.markz.fun/"]'),
          ).toHaveText("装箱单")
          await expect(page.locator('.blog-nav a[href^="/zhangjihao"]')).toHaveCount(0)
        }
        const brandStyle = await brand.evaluate((element) => {
          const style = getComputedStyle(element)
          return { family: style.fontFamily, weight: style.fontWeight }
        })
        expect(brandStyle.family).toContain(tokens.brand.wordmarkFont)
        expect(brandStyle.weight).toBe(String(tokens.brand.wordmarkWeight))

        const visitorCounter = page.locator("[data-blog-visitors]")
        if (target.id.startsWith("blog-")) {
          await expect(visitorCounter).toBeVisible()
          await expect(visitorCounter.locator("[data-blog-visitor-copy]")).toHaveText(
            "今天您是第 8 位访客 · 累计 128 位访客",
          )
          await expect(visitorCounter).toHaveAttribute("aria-busy", "false")
          await expect(visitorCounter).toHaveAttribute("role", "status")
          expect(reactions.visitorWrites).toHaveLength(1)
          expect(reactions.visitorWrites[0].visitor).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          )
        } else {
          await expect(visitorCounter).toHaveCount(0)
          expect(reactions.visitorWrites).toHaveLength(0)
        }

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
        const overflowElements =
          documentState.scrollWidth > documentState.clientWidth + 1
            ? await page.evaluate(() => {
                const clientWidth = document.documentElement.clientWidth
                return Array.from(document.body.querySelectorAll<HTMLElement>("*"))
                  .map((element) => {
                    const bounds = element.getBoundingClientRect()
                    return {
                      element: `${element.tagName.toLowerCase()}.${Array.from(element.classList).join(".")}`,
                      left: Math.round(bounds.left),
                      right: Math.round(bounds.right),
                      width: Math.round(bounds.width),
                    }
                  })
                  .filter(
                    ({ left, right, width }) => width > 0 && (left < -1 || right > clientWidth + 1),
                  )
                  .slice(0, 8)
              })
            : []
        expect(
          documentState.scrollWidth,
          `Elements outside the viewport: ${JSON.stringify(overflowElements)}`,
        ).toBeLessThanOrEqual(documentState.clientWidth + 1)
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

        if (target.id.startsWith("blog-")) {
          const footer = page.locator(".blog-site-footer")
          await footer.scrollIntoViewIfNeeded()
          await expect(footer).toBeInViewport()
          await expect(visitorCounter).toBeInViewport()
          const footerLayout = await footer.evaluate((element) => {
            const footerBounds = element.getBoundingClientRect()
            const metaBounds = element.querySelector(".blog-footer-meta")!.getBoundingClientRect()
            const navBounds = element.querySelector("nav")!.getBoundingClientRect()
            const overlaps =
              Math.min(metaBounds.right, navBounds.right) -
                Math.max(metaBounds.left, navBounds.left) >
                0 &&
              Math.min(metaBounds.bottom, navBounds.bottom) -
                Math.max(metaBounds.top, navBounds.top) >
                0
            return {
              footerLeft: footerBounds.left,
              footerRight: footerBounds.right,
              viewportWidth: document.documentElement.clientWidth,
              overlaps,
            }
          })
          expect(footerLayout.footerLeft).toBeGreaterThanOrEqual(0)
          expect(footerLayout.footerRight).toBeLessThanOrEqual(footerLayout.viewportWidth)
          expect(footerLayout.overlaps).toBe(false)
          await testInfo.attach(`${target.id}-footer-${viewport.name}-${theme}`, {
            body: await page.screenshot({ fullPage: false }),
            contentType: "image/png",
          })
          await page.evaluate(() => window.scrollTo(0, 0))
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1)
        }

        const relatedReading = page.locator("[data-related-reading]")
        if (target.id === "blog-article") {
          await expect(relatedReading).toHaveCount(1)
          const relatedLinks = relatedReading.locator(".related-reading-item > a")
          const relatedLinkCount = await relatedLinks.count()
          expect(relatedLinkCount).toBeGreaterThanOrEqual(1)
          expect(relatedLinkCount).toBeLessThanOrEqual(3)
          const currentPath = new URL(page.url()).pathname
          for (const pathname of await relatedLinks.evaluateAll((links) =>
            links.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
          )) {
            expect(pathname).toMatch(/^\/blog\/[^/]+$/)
            expect(pathname).not.toBe(currentPath)
          }
          await relatedReading.scrollIntoViewIfNeeded()
          await expect(relatedReading).toBeInViewport()
          const relatedBounds = await relatedReading.boundingBox()
          expect(relatedBounds).not.toBeNull()
          expect(relatedBounds!.x).toBeGreaterThanOrEqual(0)
          expect(relatedBounds!.x + relatedBounds!.width).toBeLessThanOrEqual(viewport.width)
          await testInfo.attach(`${target.id}-related-${viewport.name}-${theme}`, {
            body: await page.screenshot({ fullPage: false }),
            contentType: "image/png",
          })
          await page.evaluate(() => window.scrollTo(0, 0))
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1)
        } else {
          await expect(relatedReading).toHaveCount(0)
        }

        const reactionRoot = page.locator("[data-article-reaction]")
        if (target.id.endsWith("-article")) {
          await expect(reactionRoot).toHaveCount(1)
          const reactionButton = reactionRoot.locator("[data-reaction-like]")
          const reactionPanel = reactionRoot.locator("[data-reaction-panel]")
          const scrollTopButton = reactionRoot.locator("[data-scroll-to-top]")
          const viewMetric = reactionRoot.locator("[data-reaction-views]")
          await expect(reactionRoot).toHaveAttribute("aria-busy", "false")
          await expect(reactionRoot).toBeInViewport()
          await expect(reactionRoot.locator('svg[data-lucide="eye"]')).toHaveCount(1)
          await expect(reactionRoot.locator('svg[data-lucide="thumbs-up"]')).toHaveCount(1)
          await expect(reactionRoot.locator('svg[data-lucide="arrow-up"]')).toHaveCount(1)
          await expect(scrollTopButton).toBeHidden()
          await expect(scrollTopButton).toHaveAttribute("aria-hidden", "true")
          await expect(scrollTopButton).toHaveAttribute("tabindex", "-1")
          await expect(viewMetric.locator("[data-view-count]")).toHaveText("33")
          await expect(viewMetric).toHaveAttribute("aria-label", "33 次浏览")
          await expect(reactionButton).toBeEnabled()
          await expect(reactionButton).toHaveAttribute("aria-pressed", "false")
          await expect(reactionButton).toHaveAttribute("aria-disabled", "false")
          await expect(reactionButton.locator("[data-reaction-count]")).toHaveText("12")

          expect(await reactionRoot.evaluate((element) => getComputedStyle(element).position)).toBe(
            "fixed",
          )
          expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1)

          const bounds = await reactionRoot.boundingBox()
          expect(bounds).not.toBeNull()
          expect(bounds!.width).toBeGreaterThanOrEqual(44)
          expect(bounds!.height).toBeGreaterThanOrEqual(44)
          expect(bounds!.x).toBeGreaterThanOrEqual(0)
          expect(bounds!.y).toBeGreaterThanOrEqual(0)
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
          expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)

          const articleBounds = await page
            .locator("main.center > article.popover-hint")
            .boundingBox()
          expect(articleBounds).not.toBeNull()
          const safeEdge = viewport.width <= 600 ? 12 : 16
          const hasSideRoom =
            viewport.width - articleBounds!.x - articleBounds!.width >= bounds!.width + safeEdge
          if (hasSideRoom) {
            await expect(reactionRoot).toHaveAttribute("data-anchor", "article")
            expect(bounds!.x - articleBounds!.x - articleBounds!.width).toBeCloseTo(safeEdge, 0)
          } else {
            await expect(reactionRoot).toHaveAttribute("data-anchor", "viewport")
            expect(viewport.width - bounds!.x - bounds!.width).toBeCloseTo(safeEdge, 0)
          }

          const readingState = await page.evaluate(() => {
            const article = document.querySelector<HTMLElement>(
              "main.center > article.popover-hint",
            )
            if (!article) return null
            const threshold = Math.max(360, Math.min(640, window.innerHeight * 0.65))
            const articleTop = window.scrollY + article.getBoundingClientRect().top
            return {
              longEnough: article.scrollHeight - window.innerHeight >= threshold,
              revealAt: Math.ceil(articleTop + threshold + 8),
            }
          })
          expect(readingState).not.toBeNull()
          expect(readingState!.longEnough).toBe(true)
          await page.evaluate((top) => window.scrollTo(0, top), readingState!.revealAt)
          await expect
            .poll(() => page.evaluate(() => window.scrollY))
            .toBeGreaterThanOrEqual(readingState!.revealAt - 1)
          await expect(scrollTopButton).toBeVisible()
          await expect(scrollTopButton).toHaveAttribute("aria-hidden", "false")
          await expect(scrollTopButton).toHaveAttribute("tabindex", "0")
          await expect(scrollTopButton).toHaveAttribute("title", "回到顶部")

          const scrollTopBounds = await scrollTopButton.boundingBox()
          const panelBounds = await reactionPanel.boundingBox()
          const expandedBounds = await reactionRoot.boundingBox()
          expect(scrollTopBounds).not.toBeNull()
          expect(panelBounds).not.toBeNull()
          expect(expandedBounds).not.toBeNull()
          expect(scrollTopBounds!.width).toBeGreaterThanOrEqual(44)
          expect(scrollTopBounds!.height).toBeGreaterThanOrEqual(44)
          if (hasSideRoom) {
            expect(Math.abs(scrollTopBounds!.x - panelBounds!.x)).toBeLessThanOrEqual(1)
          } else {
            expect(
              Math.abs(
                scrollTopBounds!.x + scrollTopBounds!.width - (panelBounds!.x + panelBounds!.width),
              ),
            ).toBeLessThanOrEqual(1)
          }
          expect(
            panelBounds!.y - (scrollTopBounds!.y + scrollTopBounds!.height),
          ).toBeGreaterThanOrEqual(7)
          expect(
            panelBounds!.y - (scrollTopBounds!.y + scrollTopBounds!.height),
          ).toBeLessThanOrEqual(9)
          expect(expandedBounds!.y).toBeGreaterThanOrEqual(0)
          expect(expandedBounds!.y + expandedBounds!.height).toBeLessThanOrEqual(viewport.height)

          if (target.id === "notes-article" && viewport.width >= 1200) {
            const tocClearance = await page.evaluate(async () => {
              const sidebar = document.querySelector<HTMLElement>(".sidebar.right")
              const toc = document.querySelector<HTMLElement>("ul.toc-content.overflow")
              const reaction = document.querySelector<HTMLElement>("[data-article-reaction]")
              const links = toc
                ? Array.from(toc.querySelectorAll<HTMLElement>("li:not(.overflow-end) > a"))
                : []
              const lastLink = links.at(-1)
              if (!sidebar || !toc || !reaction || !lastLink) return null

              sidebar.scrollTop = sidebar.scrollHeight
              toc.scrollTop = toc.scrollHeight
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              )

              const tocBounds = toc.getBoundingClientRect()
              const reactionBounds = reaction.getBoundingClientRect()
              const lastLinkBounds = lastLink.getBoundingClientRect()
              return {
                horizontalOverlap:
                  Math.min(lastLinkBounds.right, reactionBounds.right) -
                  Math.max(lastLinkBounds.left, reactionBounds.left),
                lastLinkBottom: lastLinkBounds.bottom,
                reactionGap: reactionBounds.top - lastLinkBounds.bottom,
                reactionHeight: reactionBounds.height,
                tailClearance: tocBounds.bottom - lastLinkBounds.bottom,
                tocMaxScroll: toc.scrollHeight - toc.clientHeight,
                tocScrollTop: toc.scrollTop,
                viewportHeight: document.documentElement.clientHeight,
              }
            })

            expect(tocClearance).not.toBeNull()
            expect(tocClearance!.horizontalOverlap).toBeGreaterThan(0)
            expect(tocClearance!.tocScrollTop).toBeCloseTo(tocClearance!.tocMaxScroll, 0)
            expect(tocClearance!.tailClearance).toBeGreaterThanOrEqual(
              tocClearance!.reactionHeight + 12,
            )
            expect(tocClearance!.reactionGap).toBeGreaterThanOrEqual(16)
            expect(tocClearance!.lastLinkBottom).toBeLessThanOrEqual(tocClearance!.viewportHeight)
          }

          await reactionButton.focus()
          await page.keyboard.press("Enter")
          await expect(reactionButton).toHaveAttribute("aria-pressed", "true")
          await expect(reactionButton).toHaveAttribute("aria-disabled", "true")
          await expect(reactionButton.locator("[data-reaction-count]")).toHaveText("13")
          await expect(reactionRoot.locator("[data-reaction-status]")).toHaveText("点赞成功")
          const statusStyle = await reactionRoot
            .locator("[data-reaction-status]")
            .evaluate((element) => {
              const style = getComputedStyle(element)
              return {
                width: style.width,
                height: style.height,
                overflow: style.overflow,
                clipPath: style.clipPath,
              }
            })
          expect(statusStyle).toEqual({
            width: "1px",
            height: "1px",
            overflow: "hidden",
            clipPath: "inset(50%)",
          })
          await expect(reactionRoot).toBeInViewport()
          expect(reactions.viewWrites).toHaveLength(1)
          expect(reactions.likeWrites).toHaveLength(1)
          expect(reactions.viewWrites[0]).toMatchObject({
            site: target.id.startsWith("blog") ? "blog" : "notes",
            slug: await page.locator("body").getAttribute("data-slug"),
          })
          expect(reactions.likeWrites[0]).toMatchObject({
            site: target.id.startsWith("blog") ? "blog" : "notes",
            slug: await page.locator("body").getAttribute("data-slug"),
          })
          expect(reactions.likeWrites[0].visitor).toBe(reactions.viewWrites[0].visitor)
          if (target.id.startsWith("blog")) {
            expect(reactions.visitorWrites[0].visitor).toBe(reactions.viewWrites[0].visitor)
          }
          expect(reactions.likeWrites[0].visitor).toMatch(
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

          await scrollTopButton.focus()
          await page.keyboard.press("Enter")
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1)
          await expect(scrollTopButton).toBeHidden()
          await expect(page.locator("main.center")).toBeFocused()
        } else {
          await expect(reactionRoot).toHaveCount(0)
        }
      })
    }
  }
}

test("blog listing and article display the same editorial date", async ({ page }) => {
  await mockReactions(page)
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" })
  const firstPost = page.locator(".post-row").first()
  const listedDate = await firstPost.locator("time").getAttribute("datetime")
  expect(listedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  await firstPost.locator("a").click()
  await expect(page).toHaveURL(/\/blog\//)
  const articleDate = await page.locator(".content-meta time").getAttribute("datetime")
  expect(articleDate?.slice(0, 10)).toBe(listedDate)
})

test("editorial articles expose one decodable title-specific social image", async ({ page }) => {
  await mockReactions(page)
  await page.goto(`${pages[1].baseUrl}${pages[1].path}`, { waitUntil: "domcontentloaded" })

  const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content")
  expect(ogImage).toMatch(
    /^https:\/\/markz\.fun\/static\/social\/articles\/[a-z0-9-]+-[a-f0-9]{12}\.png$/,
  )
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", ogImage!)
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200")
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630")

  const structuredData = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}",
  )
  const article = structuredData["@graph"].find(
    (node: { "@type"?: string }) => node["@type"] === "BlogPosting",
  )
  expect(article.image).toEqual([ogImage])

  const localImageUrl = `${pages[1].baseUrl}${new URL(ogImage!).pathname}`
  const dimensions = await page.evaluate(
    (src) =>
      new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => reject(new Error(`Unable to decode ${src}`))
        image.src = src
      }),
    localImageUrl,
  )
  expect(dimensions).toEqual({ width: 1200, height: 630 })

  await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" })
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    `https://markz.fun/static/markz-card-${tokens.brand.assetRevision}.png`,
  )
})

test("editorial pages enforce CSP and render Mermaid from the local runtime", async ({ page }) => {
  const runtimeRequests: string[] = []
  const remoteMermaidRequests: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (/\/static\/vendor\/mermaid-tiny-[\d.]+\.esm\.min\.js$/.test(url.pathname)) {
      runtimeRequests.push(url.pathname)
    }
    if (url.hostname === "cdnjs.cloudflare.com") remoteMermaidRequests.push(request.url())
  })

  const response = await page.goto("http://127.0.0.1:4173/blog/ai-client-request-proxy", {
    waitUntil: "domcontentloaded",
  })
  const policy = response?.headers()["content-security-policy"] ?? ""
  expect(policy).toContain("script-src 'self'")
  expect(policy).toContain("script-src-attr 'none'")
  expect(policy).not.toContain("'unsafe-eval'")
  expect(policy.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'")

  const diagrams = page.locator("code.mermaid svg")
  await expect(diagrams.first()).toBeVisible({ timeout: 20_000 })
  expect(await diagrams.count()).toBeGreaterThan(0)
  expect(runtimeRequests).toHaveLength(1)
  expect(remoteMermaidRequests).toEqual([])
})

test("404 canonical-case recovery works with external scripts under CSP", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/BLOG/AGENT-SKILLS", {
    waitUntil: "domcontentloaded",
  })
  await expect(page).toHaveURL("http://127.0.0.1:4173/blog/agent-skills")
  await expect(page.locator('body[data-slug="blog/agent-skills"]')).toHaveCount(1)
})

test("browser title self-heals after stale product history and SPA navigation", async ({
  page,
}) => {
  await mockReactions(page)
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("MarkZ · 个人博客")

  await page.evaluate(() => {
    document.title = "JSONUtils - 专业版"
    window.dispatchEvent(new Event("pageshow"))
  })
  await expect(page).toHaveTitle("MarkZ · 个人博客")

  await page.evaluate(() =>
    window.spaNavigate(new URL("/blog/macos-network-automount", location.href)),
  )
  await expect(page.locator("body")).toHaveAttribute("data-slug", "blog/macos-network-automount")
  const articleTitle = await page.title()
  expect(articleTitle).not.toMatch(/json\s*utils/i)
  expect(articleTitle.endsWith(" · 个人博客")).toBe(true)
  await expect(page.locator("head title")).toHaveAttribute("data-page-title", articleTitle)
})

test.describe("article reactions", () => {
  test("likes survive reload while unique views and SPA page keys stay separate", async ({
    page,
  }) => {
    const mock = await mockReactions(page, 4)
    await page.goto(`${pages[1].baseUrl}${pages[1].path}`, { waitUntil: "domcontentloaded" })

    const button = page.locator("[data-reaction-like]")
    const viewCount = page.locator("[data-article-reaction] [data-view-count]")
    await expect(button).toHaveAttribute("aria-pressed", "false")
    await expect(viewCount).toHaveText("33")
    await expect(page.locator("[data-blog-visitor-copy]")).toHaveText(
      "今天您是第 8 位访客 · 累计 128 位访客",
    )
    expect(mock.visitorWrites).toHaveLength(1)
    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "true")
    const firstSlug = await page.locator("body").getAttribute("data-slug")

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.locator("[data-reaction-like]")).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator("[data-article-reaction] [data-view-count]")).toHaveText("33")
    await expect(page.locator("[data-blog-visitor-copy]")).toHaveText(
      "今天您是第 8 位访客 · 累计 128 位访客",
    )
    expect(mock.likeWrites).toHaveLength(1)
    expect(mock.viewWrites).toHaveLength(2)
    expect(mock.visitorWrites).toHaveLength(2)
    expect(mock.viewWrites[1].visitor).toBe(mock.viewWrites[0].visitor)

    await page.evaluate(() =>
      window.spaNavigate(new URL("/blog/macos-network-automount", location.href)),
    )
    await expect(page.locator("body")).toHaveAttribute("data-slug", "blog/macos-network-automount")
    await expect(page.locator("[data-article-reaction]")).toHaveCount(1)
    await expect(page.locator("[data-reaction-like]")).toHaveAttribute("aria-pressed", "false")
    await expect(page.locator("[data-article-reaction] [data-view-count]")).toHaveText("33")
    expect(mock.viewWrites).toHaveLength(3)
    expect(mock.visitorWrites).toHaveLength(2)
    expect(firstSlug).not.toBe("blog/macos-network-automount")
  })

  test("notes folder pages do not expose article reactions", async ({ page }) => {
    await mockReactions(page)
    await page.goto("http://127.0.0.1:4174/ai/", { waitUntil: "domcontentloaded" })
    await expect(page.locator(".page-listing")).toBeVisible()
    await expect(page.locator("[data-article-reaction]")).toHaveCount(0)
    await expect(page.locator("[data-scroll-to-top]")).toHaveCount(0)
    await expect(page.locator("[data-blog-visitors]")).toHaveCount(0)
  })
})

test("blog visitor counter stays quiet when the API is unavailable", async ({ page }) => {
  await mockReactions(page)
  await page.route("**/api/visitors", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"down"}' })
  })
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" })
  await expect(page.locator("[data-blog-visitors]")).toBeHidden()
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

test.describe("notes linked graph", () => {
  test.describe.configure({ mode: "serial" })

  for (const viewport of manifest.requiredViewports) {
    for (const theme of manifest.requiredThemes) {
      test(`${viewport.name} ${theme}`, async ({ page }, testInfo) => {
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

        await page.evaluate(() => document.dispatchEvent(new CustomEvent("prenav")))
        await expect(graphCanvas).toHaveCount(0)
      })
    }
  }

  test("fallback route loads the scoped self-hosted runtime", async ({ page }) => {
    test.skip(
      !existsSync(path.join(root, "public", "notes", `${linkedGraphSlug}.html`)),
      "The private note fixture is only available in publishing builds",
    )

    const runtimeRequests: string[] = []
    page.on("request", (request) => {
      if (/\/notes\/static\/vendor\/(?:d3|pixi)-graph-/.test(request.url())) {
        runtimeRequests.push(new URL(request.url()).pathname)
      }
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`http://127.0.0.1:4173/notes${linkedGraphRoute}`, {
      waitUntil: "domcontentloaded",
    })

    await expect(page.locator("body")).toHaveAttribute("data-basepath", "/notes")
    const graphCanvas = page.locator(".graph-container canvas")
    await expect(graphCanvas).toHaveCount(1, { timeout: 20_000 })
    await expect(graphCanvas).toBeVisible()
    expect(new Set(runtimeRequests)).toEqual(
      new Set([
        "/notes/static/vendor/d3-graph-7.9.0.iife.min.js",
        "/notes/static/vendor/pixi-graph-8.19.0.iife.min.js",
      ]),
    )

    await page.evaluate(() => document.dispatchEvent(new CustomEvent("prenav")))
    await expect(graphCanvas).toHaveCount(0)
  })
})

import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const root = process.cwd()
const tokens = JSON.parse(readFileSync(path.join(root, "design-system/tokens.json"), "utf8"))
const manifest = JSON.parse(readFileSync(path.join(root, "design-system/manifest.json"), "utf8"))

function firstArticle(outputRoot: string, ignoredPrefixes: string[]) {
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
    .filter((file) => readFileSync(path.join(outputRoot, file), "utf8").includes("<article"))
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

const linkedGraphSlug = "ai/agent-mcp-完全指南"
const linkedGraphRoute = "/ai/agent-mcp-%E5%AE%8C%E5%85%A8%E6%8C%87%E5%8D%97"

for (const target of pages) {
  for (const viewport of manifest.requiredViewports) {
    for (const theme of manifest.requiredThemes) {
      test(`${target.id} ${viewport.name} ${theme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.addInitScript((savedTheme) => localStorage.setItem("theme", savedTheme), theme)
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
      })
    }
  }
}

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

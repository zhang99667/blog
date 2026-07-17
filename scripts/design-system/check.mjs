import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, "../..")
const colorPattern = /^(#[0-9a-f]{6}(?:[0-9a-f]{2})?|rgba\([^\n]+\))$/i
const cssLengthPattern = /^\d+(?:\.\d+)?(?:px|rem|em|ch)$/

function relativeLuminance(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? "")) return undefined
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

export function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  if (firstLuminance === undefined || secondLuminance === undefined) return undefined
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

async function readText(root, relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8")
}

async function readJson(root, relativePath) {
  return JSON.parse(await readText(root, relativePath))
}

export function validateDesignTokens(tokens) {
  const failures = []
  if (!/^\d+\.\d+\.\d+$/.test(tokens.version ?? "")) {
    failures.push("design token version must use semantic versioning")
  }
  if (tokens.brand?.wordmark !== `${tokens.brand?.name}.`) {
    failures.push("brand.wordmark must be the brand name followed by one dot")
  }
  if (!/^v\d+$/.test(tokens.brand?.assetRevision ?? "")) {
    failures.push("brand.assetRevision must use v<number>")
  }
  if (typeof tokens.brand?.wordmarkFont !== "string" || tokens.brand.wordmarkFont.length === 0) {
    failures.push("brand.wordmarkFont must name a font")
  }
  if ((tokens.brand?.dotScale ?? 0) < 0.15 || (tokens.brand?.dotScale ?? 0) > 0.35) {
    failures.push("brand.dotScale must stay between 0.15 and 0.35")
  }

  const loadedWordmarkFont = Object.values(tokens.theme?.typography ?? {}).find(
    (font) => font?.name === tokens.brand?.wordmarkFont,
  )
  if (!loadedWordmarkFont) {
    failures.push("brand.wordmarkFont must be loaded by theme.typography")
  } else if (!loadedWordmarkFont.weights?.includes(tokens.brand.wordmarkWeight)) {
    failures.push("theme.typography must load brand.wordmarkWeight")
  }

  const colorGroups = [
    tokens.theme?.colors?.lightMode,
    tokens.theme?.colors?.darkMode,
    tokens.fixedColors,
  ]
  for (const group of colorGroups) {
    for (const [name, value] of Object.entries(group ?? {})) {
      if (typeof value !== "string" || !colorPattern.test(value)) {
        failures.push(`invalid color token: ${name}`)
      }
    }
  }

  const textContrast = tokens.accessibility?.textContrast
  if (
    typeof textContrast !== "number" ||
    textContrast < 4.5 ||
    typeof tokens.accessibility?.largeTextContrast !== "number" ||
    tokens.accessibility.largeTextContrast < 3 ||
    typeof tokens.accessibility?.nonTextContrast !== "number" ||
    tokens.accessibility.nonTextContrast < 3
  ) {
    failures.push("accessibility contrast thresholds must preserve WCAG AA minimums")
  } else {
    for (const [modeName, colors] of Object.entries(tokens.theme?.colors ?? {})) {
      for (const textToken of ["gray", "darkgray", "dark", "secondary", "tertiary"]) {
        const ratio = contrastRatio(colors?.[textToken], colors?.light)
        if (ratio !== undefined && ratio < textContrast) {
          failures.push(`${modeName}.${textToken} must meet ${textContrast}:1 text contrast`)
        }
      }
    }
  }

  for (const key of ["1", "2", "3", "4", "5", "6", "8", "10", "12", "16", "20"]) {
    if (!cssLengthPattern.test(tokens.spacing?.[key] ?? "")) {
      failures.push(`invalid spacing token: ${key}`)
    }
  }

  for (const key of [
    "display",
    "displayCompact",
    "headline",
    "headlineCompact",
    "title",
    "body",
    "label",
  ]) {
    const value = tokens.typeScale?.[key]
    if (!cssLengthPattern.test(value?.fontSize ?? "")) {
      failures.push(`invalid type scale size: ${key}`)
    }
    if (typeof value?.lineHeight !== "number" || value.lineHeight < 1) {
      failures.push(`invalid type scale line height: ${key}`)
    }
    if (!Number.isInteger(value?.weight) || value.weight < 400 || value.weight > 900) {
      failures.push(`invalid type scale weight: ${key}`)
    }
  }

  const compactBreakpoint = Number.parseFloat(tokens.breakpoints?.compact)
  const wideBreakpoint = Number.parseFloat(tokens.breakpoints?.wide)
  if (
    !/^\d+px$/.test(tokens.breakpoints?.compact ?? "") ||
    !/^\d+px$/.test(tokens.breakpoints?.wide ?? "") ||
    compactBreakpoint >= wideBreakpoint
  ) {
    failures.push("breakpoints must be ordered pixel values")
  }

  const targetMinimum = Number.parseFloat(tokens.interaction?.targetMinimum)
  const targetComfortable = Number.parseFloat(tokens.interaction?.targetComfortable)
  if (
    !/^\d+px$/.test(tokens.interaction?.targetMinimum ?? "") ||
    !/^\d+px$/.test(tokens.interaction?.targetComfortable ?? "") ||
    targetMinimum < 24 ||
    targetComfortable < targetMinimum
  ) {
    failures.push("interaction targets must preserve a 24px minimum")
  }

  return failures
}

export function findLiteralColors(source) {
  return source.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi) ?? []
}

async function requireFile(root, relativePath, failures) {
  try {
    await fs.access(path.join(root, relativePath))
  } catch {
    failures.push(`missing required design-system file: ${relativePath}`)
  }
}

function requireSnippet(source, relativePath, snippet, failures) {
  if (!source.includes(snippet)) {
    failures.push(`${relativePath} must include ${JSON.stringify(snippet)}`)
  }
}

export async function collectDesignSystemFailures(root = defaultRoot) {
  const failures = []
  const requiredFiles = [
    "design-system/tokens.json",
    "design-system/tokens.schema.json",
    "design-system/manifest.json",
    "docs/DESIGN-SYSTEM.md",
    "quartz/brand.generated.ts",
    "quartz/styles/_brand.generated.scss",
    "quartz/components/BrandMark.tsx",
    "quartz/components/scripts/accessibility.inline.ts",
    "scripts/design-system/generate.mjs",
  ]
  await Promise.all(requiredFiles.map((file) => requireFile(root, file, failures)))
  if (failures.length > 0) return failures

  const tokens = await readJson(root, "design-system/tokens.json")
  const manifest = await readJson(root, "design-system/manifest.json")
  failures.push(...validateDesignTokens(tokens))

  if (manifest.tokenVersion !== tokens.version) {
    failures.push("design-system/manifest.json tokenVersion must match tokens.json")
  }
  for (const asset of [
    `quartz/static/markz-icon-${tokens.brand.assetRevision}.png`,
    `quartz/static/markz-card-${tokens.brand.assetRevision}.png`,
  ]) {
    if (!manifest.generatedArtifacts?.includes(asset)) {
      failures.push(`design-system/manifest.json must register ${asset}`)
    }
  }
  if (manifest.surfaces?.blog?.identity !== tokens.brand.name) {
    failures.push("blog surface must use the personal MarkZ identity")
  }
  if (manifest.surfaces?.notes?.identity !== tokens.brand.name) {
    failures.push("notes surface must use the personal MarkZ identity")
  }
  if (manifest.surfaces?.jsonutils?.inheritsPersonalWordmark !== false) {
    failures.push("JSONUtils must retain its independent product identity")
  }
  if (manifest.surfaces?.["packing-list"]?.inheritsPersonalWordmark !== false) {
    failures.push("packing-list must retain its independent product identity")
  }

  const customStyles = await readText(root, "quartz/styles/custom.scss")
  requireSnippet(customStyles, "quartz/styles/custom.scss", '@use "./brand.generated";', failures)
  requireSnippet(
    customStyles,
    "quartz/styles/custom.scss",
    "font-family: var(--brand-wordmark-font);",
    failures,
  )
  for (const snippet of [
    "var(--brand-type-display-size)",
    "var(--brand-target-comfortable)",
    "brand.$breakpoint-compact",
    "brand.$breakpoint-wide",
    'article img[src$=".svg"]',
    "color-scheme: light",
  ]) {
    requireSnippet(customStyles, "quartz/styles/custom.scss", snippet, failures)
  }
  const literalColors = findLiteralColors(customStyles)
  if (literalColors.length > 0) {
    failures.push(
      `quartz/styles/custom.scss contains literal colors: ${[...new Set(literalColors)].join(", ")}`,
    )
  }

  const blogFrame = await readText(root, "quartz/components/frames/BlogFrame.tsx")
  requireSnippet(blogFrame, "quartz/components/frames/BlogFrame.tsx", "<BrandMark", failures)
  requireSnippet(
    blogFrame,
    "quartz/components/frames/BlogFrame.tsx",
    '<main class="center',
    failures,
  )

  const defaultFrame = await readText(root, "quartz/components/frames/DefaultFrame.tsx")
  requireSnippet(
    defaultFrame,
    "quartz/components/frames/DefaultFrame.tsx",
    '<main class="center',
    failures,
  )

  const renderPage = await readText(root, "quartz/components/renderPage.tsx")
  requireSnippet(
    renderPage,
    "quartz/components/renderPage.tsx",
    "enhanceContentAccessibility",
    failures,
  )
  requireSnippet(
    renderPage,
    "quartz/components/renderPage.tsx",
    "node.properties.tabIndex = 0",
    failures,
  )

  const accessibilityScript = await readText(
    root,
    "quartz/components/scripts/accessibility.inline.ts",
  )
  requireSnippet(
    accessibilityScript,
    "quartz/components/scripts/accessibility.inline.ts",
    'explorer.removeAttribute("aria-expanded")',
    failures,
  )
  requireSnippet(
    accessibilityScript,
    "quartz/components/scripts/accessibility.inline.ts",
    'button.setAttribute("aria-controls", content.id)',
    failures,
  )
  requireSnippet(
    accessibilityScript,
    "quartz/components/scripts/accessibility.inline.ts",
    "restoreDocumentPositionAfterExplorerRender",
    failures,
  )

  const quartzConfig = await readText(root, "quartz.ts")
  requireSnippet(quartzConfig, "quartz.ts", "theme: brandTheme", failures)
  requireSnippet(
    quartzConfig,
    "quartz.ts",
    'componentRegistry.replace("PageTitle", BrandPageTitle',
    failures,
  )
  requireSnippet(
    quartzConfig,
    "quartz.ts",
    'componentRegistry.replace("page-title", BrandPageTitle',
    failures,
  )

  const head = await readText(root, "quartz/components/Head.tsx")
  requireSnippet(head, "quartz/components/Head.tsx", "brandIdentity.assets.icon", failures)
  requireSnippet(head, "quartz/components/Head.tsx", "brandIdentity.assets.socialCard", failures)
  requireSnippet(head, "quartz/components/Head.tsx", 'replace(/^\\./, "")', failures)

  const brandMark = await readText(root, "quartz/components/BrandMark.tsx")
  requireSnippet(brandMark, "quartz/components/BrandMark.tsx", "data-brand-version", failures)

  const sync = await readText(root, "scripts/sync-notes.mjs")
  requireSnippet(sync, "scripts/sync-notes.mjs", "design-system/tokens.json", failures)
  requireSnippet(sync, "scripts/sync-notes.mjs", "articleSocialImageDescriptor", failures)

  const articleSocialImages = await readText(
    root,
    "scripts/design-system/article-social-images.mjs",
  )
  for (const snippet of [
    "articleSocialImageContract",
    "tokens.fixedColors",
    "tokens.brand.domain",
    "checksum mismatch",
  ]) {
    requireSnippet(
      articleSocialImages,
      "scripts/design-system/article-social-images.mjs",
      snippet,
      failures,
    )
  }
  for (const font of [
    "design-system/fonts/noto-sans-sc-chinese-simplified-800-normal.woff",
    "design-system/fonts/noto-sans-sc-latin-800-normal.woff",
  ]) {
    try {
      await fs.access(path.join(root, font))
    } catch {
      failures.push(`${font} is missing`)
    }
  }

  const yaml = await readText(root, "quartz.config.yaml")
  if (/^\s{2}theme:/m.test(yaml)) {
    failures.push("quartz.config.yaml must not duplicate the generated theme tokens")
  }
  requireSnippet(yaml, "quartz.config.yaml", "github-light-high-contrast", failures)
  requireSnippet(yaml, "quartz.config.yaml", "github-dark-high-contrast", failures)

  const bannedSources = [
    "quartz.ts",
    "quartz/components/BrandMark.tsx",
    "quartz/components/frames/BlogFrame.tsx",
    "scripts/sync-notes.mjs",
  ]
  for (const file of bannedSources) {
    const source = await readText(root, file)
    if (source.includes("MarkZ Notes"))
      failures.push(`${file} contains the retired MarkZ Notes mark`)
  }

  return failures
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const failures = await collectDesignSystemFailures()
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
  } else {
    console.log("MarkZ design-system contract is valid.")
  }
}

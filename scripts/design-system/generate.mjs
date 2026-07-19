import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, "../..")

export async function readDesignTokens(root = defaultRoot) {
  const source = await fs.readFile(path.join(root, "design-system/tokens.json"), "utf8")
  return JSON.parse(source)
}

function assetNames(tokens) {
  const revision = tokens.brand.assetRevision
  return {
    icon: `markz-icon-${revision}.png`,
    socialCard: `markz-card-${revision}.png`,
  }
}

export function renderBrandModule(tokens) {
  const assets = assetNames(tokens)
  const identity = {
    version: tokens.version,
    name: tokens.brand.name,
    wordmark: tokens.brand.wordmark,
    tagline: tokens.brand.tagline,
    description: tokens.brand.description,
    domain: tokens.brand.domain,
    assets,
  }

  return `// Generated from design-system/tokens.json. Do not edit by hand.\nimport type { Theme } from "./util/theme"\n\nexport const brandIdentity = ${JSON.stringify(identity, null, 2)} as const\n\nexport const brandTheme = ${JSON.stringify(tokens.theme, null, 2)} satisfies Theme\n`
}

export function renderBrandStyles(tokens) {
  const { lightMode, darkMode } = tokens.theme.colors
  const { shape, layout, motion, interaction } = tokens
  const lines = [
    "// Generated from design-system/tokens.json. Do not edit by hand.",
    `$breakpoint-compact: ${tokens.breakpoints.compact};`,
    `$breakpoint-wide: ${tokens.breakpoints.wide};`,
    `$breakpoint-reading-rail: ${tokens.breakpoints.readingRail};`,
    "",
    ":root {",
    `  --brand-canvas: ${lightMode.light};`,
    `  --brand-line: ${lightMode.lightgray};`,
    `  --brand-muted: ${lightMode.gray};`,
    `  --brand-ink-soft: ${lightMode.darkgray};`,
    `  --brand-ink: ${lightMode.dark};`,
    `  --brand-accent: ${lightMode.secondary};`,
    `  --brand-fixed-surface: ${tokens.fixedColors.brandSurface};`,
    `  --brand-fixed-ink: ${tokens.fixedColors.brandInk};`,
    `  --brand-fixed-muted: ${tokens.fixedColors.brandMuted};`,
    `  --brand-fixed-accent: ${tokens.fixedColors.brandAccent};`,
    `  --brand-fixed-line: ${tokens.fixedColors.brandLine};`,
    `  --brand-wordmark-font: ${JSON.stringify(tokens.brand.wordmarkFont)}, sans-serif;`,
    `  --brand-wordmark-weight: ${tokens.brand.wordmarkWeight};`,
    `  --brand-dot-size: ${tokens.brand.dotScale}em;`,
    `  --brand-control-radius: ${shape.controlRadius};`,
    `  --brand-image-radius: ${shape.imageRadius};`,
    `  --brand-focus-radius: ${shape.focusRadius};`,
    `  --brand-shell-max: ${layout.shellMax};`,
    `  --brand-article-max: ${layout.articleMax};`,
    `  --brand-home-max: ${layout.homeMax};`,
    `  --brand-archive-max: ${layout.archiveMax};`,
    `  --brand-reading-measure: ${layout.readingMeasure};`,
    `  --brand-target-min: ${interaction.targetMinimum};`,
    `  --brand-target-comfortable: ${interaction.targetComfortable};`,
    `  --brand-focus-width: ${interaction.focusWidth};`,
    `  --brand-focus-offset: ${interaction.focusOffset};`,
    `  --brand-motion-fast: ${motion.fast};`,
    `  --brand-motion-easing: ${motion.easing};`,
    ...Object.entries(tokens.spacing).map(([name, value]) => `  --brand-space-${name}: ${value};`),
    ...Object.entries(tokens.typeScale).flatMap(([name, value]) => {
      const cssName = name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
      return [
        `  --brand-type-${cssName}-size: ${value.fontSize};`,
        `  --brand-type-${cssName}-line: ${value.lineHeight};`,
        `  --brand-type-${cssName}-weight: ${value.weight};`,
      ]
    }),
    "}",
    "",
    ':root[saved-theme="dark"] {',
    `  --brand-canvas: ${darkMode.light};`,
    `  --brand-line: ${darkMode.lightgray};`,
    `  --brand-muted: ${darkMode.gray};`,
    `  --brand-ink-soft: ${darkMode.darkgray};`,
    `  --brand-ink: ${darkMode.dark};`,
    `  --brand-accent: ${darkMode.secondary};`,
    "}",
    "",
  ]

  return lines.join("\n")
}

function renderIconSvg(tokens) {
  const colors = tokens.fixedColors
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="48" fill="${colors.brandSurface}"/>
  <text x="48" y="340" fill="${colors.brandInk}" font-family="${tokens.brand.wordmarkFont}, sans-serif" font-size="220" font-weight="${tokens.brand.wordmarkWeight}" textLength="320" lengthAdjust="spacingAndGlyphs">MZ</text>
  <circle cx="410" cy="315" r="25" fill="${colors.brandAccent}"/>
</svg>`
}

function renderSocialCardSvg(tokens) {
  const colors = tokens.fixedColors
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${colors.brandSurface}"/>
  <text x="90" y="318" fill="${colors.brandInk}" font-family="${tokens.brand.wordmarkFont}, sans-serif" font-size="132" font-weight="${tokens.brand.wordmarkWeight}" textLength="412" lengthAdjust="spacingAndGlyphs">${tokens.brand.name}</text>
  <circle cx="520" cy="304" r="15" fill="${colors.brandAccent}"/>
  <text x="90" y="390" fill="${colors.brandMuted}" font-family="Noto Sans SC, sans-serif" font-size="28" font-weight="500">${tokens.brand.tagline}</text>
  <line x1="90" y1="472" x2="1110" y2="472" stroke="${colors.brandLine}" stroke-width="2"/>
  <text x="90" y="520" fill="${colors.brandMuted}" font-family="JetBrains Mono, monospace" font-size="22">${tokens.brand.domain}</text>
</svg>`
}

async function writeTextArtifact(root, relativePath, content) {
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

async function writeImageArtifacts(root, tokens) {
  const staticDir = path.join(root, "quartz/static")
  const assets = assetNames(tokens)
  const icon = Buffer.from(renderIconSvg(tokens))
  const socialCard = Buffer.from(renderSocialCardSvg(tokens))

  await Promise.all([
    sharp(icon).png().toFile(path.join(staticDir, "icon.png")),
    sharp(icon).png().toFile(path.join(staticDir, assets.icon)),
    sharp(socialCard).png().toFile(path.join(staticDir, "og-image.png")),
    sharp(socialCard).png().toFile(path.join(staticDir, assets.socialCard)),
  ])
}

export async function generateDesignSystem(root = defaultRoot) {
  const tokens = await readDesignTokens(root)
  await Promise.all([
    writeTextArtifact(root, "quartz/brand.generated.ts", renderBrandModule(tokens)),
    writeTextArtifact(root, "quartz/styles/_brand.generated.scss", renderBrandStyles(tokens)),
  ])
  await writeImageArtifacts(root, tokens)
}

async function checkTextArtifact(root, relativePath, expected, failures) {
  try {
    const actual = await fs.readFile(path.join(root, relativePath), "utf8")
    if (actual !== expected) failures.push(`${relativePath} is stale`)
  } catch {
    failures.push(`${relativePath} is missing`)
  }
}

async function checkImage(root, relativePath, expectedWidth, expectedHeight, failures) {
  try {
    const metadata = await sharp(path.join(root, relativePath)).metadata()
    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      failures.push(`${relativePath} must be ${expectedWidth}x${expectedHeight}`)
    }
  } catch {
    failures.push(`${relativePath} is missing or unreadable`)
  }
}

export async function checkGeneratedDesignSystem(root = defaultRoot) {
  const tokens = await readDesignTokens(root)
  const assets = assetNames(tokens)
  const failures = []

  await Promise.all([
    checkTextArtifact(root, "quartz/brand.generated.ts", renderBrandModule(tokens), failures),
    checkTextArtifact(
      root,
      "quartz/styles/_brand.generated.scss",
      renderBrandStyles(tokens),
      failures,
    ),
    checkImage(root, "quartz/static/icon.png", 512, 512, failures),
    checkImage(root, `quartz/static/${assets.icon}`, 512, 512, failures),
    checkImage(root, "quartz/static/og-image.png", 1200, 630, failures),
    checkImage(root, `quartz/static/${assets.socialCard}`, 1200, 630, failures),
  ])

  return failures
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  if (process.argv.includes("--check")) {
    const failures = await checkGeneratedDesignSystem()
    if (failures.length > 0) {
      for (const failure of failures) console.error(`- ${failure}`)
      process.exitCode = 1
    } else {
      console.log("Generated design system artifacts are current.")
    }
  } else {
    await generateDesignSystem()
    console.log("Generated MarkZ theme, CSS tokens, and brand assets.")
  }
}

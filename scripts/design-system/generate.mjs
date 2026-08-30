import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, "../..")
const wordmarkFontSource = "design-system/fonts/noto-sans-sc-latin-800-normal.woff"

export async function readDesignTokens(root = defaultRoot) {
  const source = await fs.readFile(path.join(root, "design-system/tokens.json"), "utf8")
  return JSON.parse(source)
}

function assetNames(tokens) {
  const revision = tokens.brand.assetRevision
  return {
    icon: `markz-icon-${revision}.png`,
    socialCard: `markz-card-${revision}.png`,
    wordmarkFont: `fonts/markz-wordmark-latin-${revision}.woff`,
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
    "@font-face {",
    '  font-family: "MarkZ Wordmark";',
    `  src: url("/static/${assetNames(tokens).wordmarkFont}") format("woff");`,
    `  font-weight: ${tokens.brand.wordmarkWeight};`,
    "  font-style: normal;",
    "  font-display: swap;",
    "  unicode-range: U+0020-007E;",
    "}",
    "",
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
    `  --brand-wordmark-font: "MarkZ Wordmark", ${JSON.stringify(tokens.brand.wordmarkFont)}, sans-serif;`,
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

function colorWithAlpha(hex, alpha) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Expected a six-digit hex color, received ${hex}`)
  }
  const alphaByte = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")
  return `${hex}${alphaByte}`
}

export function renderGiscusTheme(tokens, mode) {
  if (mode !== "lightMode" && mode !== "darkMode") {
    throw new Error(`Unsupported Giscus theme mode: ${mode}`)
  }

  const colors = tokens.theme.colors[mode]
  const dark = mode === "darkMode"
  const canvas = colors.light
  const foreground = colors.dark
  const muted = colors.gray
  const subtle = colors.darkgray
  const line = colors.lightgray
  const accent = colors.secondary
  const signal = colors.tertiary
  const softLine = colorWithAlpha(foreground, dark ? 0.16 : 0.14)
  const faintLine = colorWithAlpha(foreground, dark ? 0.1 : 0.08)
  const softAccent = colorWithAlpha(accent, dark ? 0.2 : 0.14)
  const mutedFill = colorWithAlpha(muted, dark ? 0.22 : 0.16)
  const primaryText = dark ? canvas : tokens.fixedColors.brandSurface

  const variables = {
    "color-prettylights-syntax-comment": muted,
    "color-prettylights-syntax-constant": accent,
    "color-prettylights-syntax-entity": signal,
    "color-prettylights-syntax-storage-modifier-import": foreground,
    "color-prettylights-syntax-entity-tag": accent,
    "color-prettylights-syntax-keyword": signal,
    "color-prettylights-syntax-string": subtle,
    "color-prettylights-syntax-variable": signal,
    "color-prettylights-syntax-brackethighlighter-unmatched": signal,
    "color-prettylights-syntax-invalid-illegal-text": canvas,
    "color-prettylights-syntax-invalid-illegal-bg": signal,
    "color-prettylights-syntax-carriage-return-text": canvas,
    "color-prettylights-syntax-carriage-return-bg": signal,
    "color-prettylights-syntax-string-regexp": accent,
    "color-prettylights-syntax-markup-list": signal,
    "color-prettylights-syntax-markup-heading": accent,
    "color-prettylights-syntax-markup-italic": foreground,
    "color-prettylights-syntax-markup-bold": foreground,
    "color-prettylights-syntax-markup-deleted-text": signal,
    "color-prettylights-syntax-markup-deleted-bg": colorWithAlpha(signal, 0.14),
    "color-prettylights-syntax-markup-inserted-text": accent,
    "color-prettylights-syntax-markup-inserted-bg": softAccent,
    "color-prettylights-syntax-markup-changed-text": signal,
    "color-prettylights-syntax-markup-changed-bg": colorWithAlpha(signal, 0.12),
    "color-prettylights-syntax-markup-ignored-text": foreground,
    "color-prettylights-syntax-markup-ignored-bg": softAccent,
    "color-prettylights-syntax-meta-diff-range": signal,
    "color-prettylights-syntax-brackethighlighter-angle": muted,
    "color-prettylights-syntax-sublimelinter-gutter-mark": muted,
    "color-prettylights-syntax-constant-other-reference-link": accent,
    "color-btn-text": foreground,
    "color-btn-bg": canvas,
    "color-btn-border": softLine,
    "color-btn-shadow": `0 1px 0 ${faintLine}`,
    "color-btn-inset-shadow": `inset 0 1px 0 ${faintLine}`,
    "color-btn-hover-bg": line,
    "color-btn-hover-border": softLine,
    "color-btn-active-bg": line,
    "color-btn-active-border": colorWithAlpha(foreground, 0.24),
    "color-btn-selected-bg": line,
    "color-btn-primary-text": primaryText,
    "color-btn-primary-bg": accent,
    "color-btn-primary-border": softLine,
    "color-btn-primary-shadow": `0 1px 0 ${faintLine}`,
    "color-btn-primary-inset-shadow": `inset 0 1px 0 ${faintLine}`,
    "color-btn-primary-hover-bg": accent,
    "color-btn-primary-hover-border": colorWithAlpha(foreground, 0.24),
    "color-btn-primary-selected-bg": accent,
    "color-btn-primary-selected-shadow": `inset 0 1px 0 ${softLine}`,
    "color-btn-primary-disabled-text": colorWithAlpha(primaryText, 0.72),
    "color-btn-primary-disabled-bg": colorWithAlpha(accent, 0.58),
    "color-btn-primary-disabled-border": faintLine,
    "color-action-list-item-default-hover-bg": mutedFill,
    "color-segmented-control-bg": mutedFill,
    "color-segmented-control-button-bg": canvas,
    "color-segmented-control-button-selected-border": muted,
    "color-fg-default": foreground,
    "color-fg-muted": muted,
    "color-fg-subtle": subtle,
    "color-canvas-default": canvas,
    "color-canvas-overlay": canvas,
    "color-canvas-inset": line,
    "color-canvas-subtle": colorWithAlpha(line, dark ? 0.48 : 0.62),
    "color-border-default": line,
    "color-border-muted": faintLine,
    "color-neutral-muted": mutedFill,
    "color-accent-fg": accent,
    "color-accent-emphasis": accent,
    "color-accent-muted": colorWithAlpha(accent, 0.38),
    "color-accent-subtle": softAccent,
    "color-success-fg": accent,
    "color-attention-fg": signal,
    "color-attention-muted": colorWithAlpha(signal, 0.38),
    "color-attention-subtle": colorWithAlpha(signal, 0.12),
    "color-danger-fg": signal,
    "color-danger-muted": colorWithAlpha(signal, 0.38),
    "color-danger-subtle": colorWithAlpha(signal, 0.12),
    "color-primer-shadow-inset": `inset 0 1px 0 ${faintLine}`,
    "color-scale-gray-1": line,
    "color-scale-gray-7": line,
    "color-scale-blue-1": softAccent,
    "color-scale-blue-8": softAccent,
    "color-social-reaction-bg-hover": line,
    "color-social-reaction-bg-reacted-hover": softAccent,
  }

  const declarations = Object.entries(variables)
    .map(([name, value]) => `--${name}:${value}`)
    .join(";")
  return [
    "/* Generated from design-system/tokens.json. Do not edit by hand. */",
    `main{color-scheme:${dark ? "dark" : "light"};${declarations}}`,
    "",
  ].join("\n")
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

async function writeFontArtifact(root, tokens) {
  const source = path.join(root, wordmarkFontSource)
  const target = path.join(root, "quartz/static", assetNames(tokens).wordmarkFont)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
}

export async function generateDesignSystem(root = defaultRoot) {
  const tokens = await readDesignTokens(root)
  await Promise.all([
    writeTextArtifact(root, "quartz/brand.generated.ts", renderBrandModule(tokens)),
    writeTextArtifact(root, "quartz/styles/_brand.generated.scss", renderBrandStyles(tokens)),
    writeTextArtifact(
      root,
      "quartz/static/giscus/markz-light.css",
      renderGiscusTheme(tokens, "lightMode"),
    ),
    writeTextArtifact(
      root,
      "quartz/static/giscus/markz-dark.css",
      renderGiscusTheme(tokens, "darkMode"),
    ),
    writeFontArtifact(root, tokens),
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

async function checkFontArtifact(root, tokens, failures) {
  try {
    const [source, generated] = await Promise.all([
      fs.readFile(path.join(root, wordmarkFontSource)),
      fs.readFile(path.join(root, "quartz/static", assetNames(tokens).wordmarkFont)),
    ])
    if (!source.equals(generated)) failures.push("generated wordmark font is stale")
  } catch {
    failures.push("generated wordmark font is missing or unreadable")
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
    checkTextArtifact(
      root,
      "quartz/static/giscus/markz-light.css",
      renderGiscusTheme(tokens, "lightMode"),
      failures,
    ),
    checkTextArtifact(
      root,
      "quartz/static/giscus/markz-dark.css",
      renderGiscusTheme(tokens, "darkMode"),
      failures,
    ),
    checkImage(root, "quartz/static/icon.png", 512, 512, failures),
    checkImage(root, `quartz/static/${assets.icon}`, 512, 512, failures),
    checkImage(root, "quartz/static/og-image.png", 1200, 630, failures),
    checkImage(root, `quartz/static/${assets.socialCard}`, 1200, 630, failures),
    checkFontArtifact(root, tokens, failures),
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

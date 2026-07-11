import assert from "node:assert/strict"
import { test } from "node:test"
import { contrastRatio, findLiteralColors, validateDesignTokens } from "./check.mjs"

const validTokens = {
  version: "1.0.0",
  brand: {
    name: "MarkZ",
    wordmark: "MarkZ.",
    assetRevision: "v1",
    wordmarkFont: "Noto Sans SC",
    wordmarkWeight: 800,
    dotScale: 0.23,
  },
  theme: {
    typography: {
      body: { name: "Noto Sans SC", weights: [400, 800] },
    },
    colors: {
      lightMode: {
        light: "#fafaf8",
        gray: "#646962",
        darkgray: "#454842",
        dark: "#191c17",
        secondary: "#1759b6",
        tertiary: "#a64032",
        highlight: "rgba(23, 89, 181, 0.11)",
      },
      darkMode: {
        light: "#171916",
        gray: "#858b84",
        darkgray: "#d9ddd7",
        dark: "#f1f4ed",
        secondary: "#84b2f4",
        tertiary: "#ef927b",
        highlight: "rgba(132, 178, 244, 0.14)",
      },
    },
  },
  fixedColors: { brandSurface: "#151713" },
  spacing: {
    1: "0.25rem",
    2: "0.5rem",
    3: "0.75rem",
    4: "1rem",
    5: "1.25rem",
    6: "1.5rem",
    8: "2rem",
    10: "2.5rem",
    12: "3rem",
    16: "4rem",
    20: "5rem",
  },
  typeScale: Object.fromEntries(
    ["display", "displayCompact", "headline", "headlineCompact", "title", "body", "label"].map(
      (name) => [name, { fontSize: "1rem", lineHeight: 1.4, weight: 700 }],
    ),
  ),
  breakpoints: { compact: "800px", wide: "1200px" },
  interaction: { targetMinimum: "24px", targetComfortable: "44px" },
  accessibility: { textContrast: 4.5, largeTextContrast: 3, nonTextContrast: 3 },
}

test("valid design tokens pass the core contract", () => {
  assert.deepEqual(validateDesignTokens(validTokens), [])
})

test("brand and color drift is rejected", () => {
  const tokens = structuredClone(validTokens)
  tokens.brand.wordmark = "MarkZ Notes"
  tokens.brand.dotScale = 0.5
  tokens.theme.colors.lightMode.light = "blue"

  assert.deepEqual(validateDesignTokens(tokens), [
    "brand.wordmark must be the brand name followed by one dot",
    "brand.dotScale must stay between 0.15 and 0.35",
    "invalid color token: light",
  ])
})

test("literal colors are detectable outside generated token files", () => {
  assert.deepEqual(findLiteralColors("color: #123456; background: rgba(1, 2, 3, 0.4);"), [
    "#123456",
    "rgba(1, 2, 3, 0.4)",
  ])
})

test("contrast ratios and semantic text colors preserve WCAG AA", () => {
  assert.ok(contrastRatio("#646962", "#fafaf8") >= 4.5)

  const tokens = structuredClone(validTokens)
  tokens.theme.colors.lightMode.gray = "#8b8d87"
  assert.deepEqual(validateDesignTokens(tokens), ["lightMode.gray must meet 4.5:1 text contrast"])
})

test("wordmark font and weight must be loaded by the theme", () => {
  const tokens = structuredClone(validTokens)
  tokens.theme.typography.body.weights = [400]

  assert.deepEqual(validateDesignTokens(tokens), [
    "theme.typography must load brand.wordmarkWeight",
  ])
})

test("foundation scales reject invalid values", () => {
  const tokens = structuredClone(validTokens)
  tokens.spacing[4] = "large"
  tokens.typeScale.body.lineHeight = 0.9
  tokens.breakpoints.wide = "700px"
  tokens.interaction.targetMinimum = "20px"

  assert.deepEqual(validateDesignTokens(tokens), [
    "invalid spacing token: 4",
    "invalid type scale line height: body",
    "breakpoints must be ordered pixel values",
    "interaction targets must preserve a 24px minimum",
  ])
})

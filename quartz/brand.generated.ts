// Generated from design-system/tokens.json. Do not edit by hand.
import type { Theme } from "./util/theme"

export const brandIdentity = {
  "version": "1.3.1",
  "name": "MarkZ",
  "wordmark": "MarkZ.",
  "tagline": "个人博客",
  "description": "技术、产品与日常的个人记录。",
  "domain": "markz.fun",
  "assets": {
    "icon": "markz-icon-v3.png",
    "socialCard": "markz-card-v3.png"
  }
} as const

export const brandTheme = {
  "fontOrigin": "googleFonts",
  "cdnCaching": true,
  "typography": {
    "header": {
      "name": "Noto Serif SC",
      "weights": [
        400,
        700
      ]
    },
    "body": {
      "name": "Noto Sans SC",
      "weights": [
        400,
        600,
        800
      ],
      "includeItalic": true
    },
    "code": {
      "name": "JetBrains Mono",
      "weights": [
        400,
        600,
        700,
        800
      ]
    }
  },
  "colors": {
    "lightMode": {
      "light": "#fafaf8",
      "lightgray": "#e3e2dc",
      "gray": "#646962",
      "darkgray": "#454842",
      "dark": "#191c17",
      "secondary": "#1759b6",
      "tertiary": "#a64032",
      "highlight": "rgba(23, 89, 181, 0.11)",
      "textHighlight": "#f0d66a80"
    },
    "darkMode": {
      "light": "#171916",
      "lightgray": "#343733",
      "gray": "#858b84",
      "darkgray": "#d9ddd7",
      "dark": "#f1f4ed",
      "secondary": "#84b2f4",
      "tertiary": "#ef927b",
      "highlight": "rgba(132, 178, 244, 0.14)",
      "textHighlight": "#b69f2788"
    }
  }
} satisfies Theme

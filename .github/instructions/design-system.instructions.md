---
applyTo: "design-system/**,quartz/styles/**,quartz/components/**"
---

Read `docs/DESIGN-SYSTEM.md`, `docs/SYSTEM-BENCHMARKS.md`, and `design-system/manifest.json` before editing.

- Change visual values in `design-system/tokens.json`; do not hand-edit generated TS, SCSS, or PNG files.
- Reuse `BrandMark` and semantic variables. Do not duplicate personal-brand markup.
- Preserve product identity boundaries for JSONUtils and the packing-list tool.
- Validate 320x800, 390x844, and 1440x900 in light and dark themes.
- Run `npm run design:generate`, `npm run design:check`, and `npm run quality:check`.

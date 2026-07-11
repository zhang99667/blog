# MarkZ repository instructions

Read `AGENTS.md` before editing. The machine-readable authority graph is `ai/manifest.json`; the shared workflow is `docs/AI-ENGINEERING-PLAYBOOK.md`.

- Use `design-system/tokens.json` as the only visual token source.
- Use `quartz/components/BrandMark.tsx` for the personal wordmark.
- Do not edit generated content, generated theme files, or brand PNG files.
- Keep blog, notes, JSONUtils, and packing-list product roles separate.
- Apply matching path-specific instructions from `.github/instructions/`.
- Run `npm run check`, `npm test`, and `npm run build` before declaring completion; UI changes also run `npm run quality:web`.

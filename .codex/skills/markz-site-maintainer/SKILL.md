---
name: markz-site-maintainer
description: Maintain the MarkZ personal blog and public notes across branding, visual design, Quartz components, Obsidian synchronization, responsive UI, deployment, and AI governance. Use when changing markz.fun or note.markz.fun, the MarkZ wordmark, design tokens, generated brand assets, navigation, content publishing, Nginx edge routing, repository AI instructions, or visual regression checks.
---

# MarkZ Site Maintainer

Keep every change aligned with the repository's design source, content pipeline, product boundaries, and verification gates.

## Required reading

1. Read `AGENTS.md`.
2. Read `ai/manifest.json`, `docs/ARCHITECTURE.md`, and `design-system/manifest.json`.
3. For UI or branding, read `docs/DESIGN-SYSTEM.md`.
4. For deployment or repeated failures, read `docs/AI-DECISIONS.md`.
5. For AI rules, skills, or evals, read `docs/AI-ENGINEERING-PLAYBOOK.md` and `docs/AI-ASSET-REGISTRY.md`.

## Workflow

1. Run `git status --short --branch` and preserve user changes.
2. Identify the authority for the requested change. Do not edit generated outputs.
3. Define success across affected routes, themes, and responsive viewports.
4. Reuse `BrandMark` and generated semantic variables for personal-brand UI.
5. Generate design artifacts after token changes.
6. Run scoped checks, then the full verification gate before deployment.
7. Run browser quality checks and inspect real built pages at 320x800, 390x844, and 1440x900 in light and dark themes.
8. After deployment, verify blog, notes, JSONUtils, admin, packing-list, and API routes.
9. Turn user corrections or repeated incidents into a decision entry and deterministic check.

## Command map

```bash
npm run design:generate
npm run design:check
npm run ai:check
npm run evals:check
npm run quality:build
npm run quality:web
npm run check
npm test
npm run build
npm run verify
npm run deploy
```

## Authority map

- Visual values: `design-system/tokens.json`.
- Surface roles: `design-system/manifest.json`.
- Wordmark component: `quartz/components/BrandMark.tsx`.
- Blog homepage template and note publishing: `scripts/sync-notes.mjs`.
- Edge routing: `deploy/nginx.conf` and `deploy/docker-compose.edge.yml`.
- AI workflow: `docs/AI-ENGINEERING-PLAYBOOK.md`.
- Machine-readable authority and evidence graph: `ai/manifest.json`.

## Boundaries

- Do not add literal colors to `quartz/styles/custom.scss`.
- Do not create another MarkZ wordmark implementation.
- Do not restore `MarkZ Notes`; site role belongs in copy, not the wordmark.
- Do not rename JSONUtils or the packing-list product to MarkZ.
- Do not bind JSONUtils to host ports 80 or 443.
- Do not use generated Markdown, HTML, TS, SCSS, or PNG as an editing source.
- Do not claim visual completion from one viewport, one theme, or one screenshot.

## Rule evolution

When a correction exposes a reusable failure mode, update `docs/AI-DECISIONS.md`, the relevant authority, and an automated check. Register new AI assets in `docs/AI-ASSET-REGISTRY.md` and run `npm run ai:check`.

---
applyTo: "scripts/sync-notes.mjs,scripts/blog.config.mjs,content/**"
---

Read `docs/ARCHITECTURE.md` before changing publication behavior.

- Obsidian source and sync rules are authoritative; generated `content/` files are not editing sources.
- Preserve the distinction between polished blog posts and networked public notes.
- Discover public note collections from eligible top-level Vault directories instead of hard-coding every category. Hidden, system, and explicitly excluded directories stay private; Markdown requires `publish: true` before it can enter the public notes build.
- Keep source commit, copied/unchanged counts, public markers, slugs, and asset handling observable.
- Published dates come from explicit note frontmatter, then the note repository's Git history. Never use checkout or generated-file timestamps as public dates.
- After changes run `npm run sync`, `npm test`, `npm run build`, and `npm run quality:build`.

---
applyTo: "scripts/sync-notes.mjs,scripts/blog.config.mjs,content/**"
---

Read `docs/ARCHITECTURE.md` before changing publication behavior.

- Obsidian source and sync rules are authoritative; generated `content/` files are not editing sources.
- Preserve the distinction between polished blog posts and networked public notes.
- Keep source commit, copied/unchanged counts, public markers, slugs, and asset handling observable.
- After changes run `npm run sync`, `npm test`, `npm run build`, and `npm run quality:build`.

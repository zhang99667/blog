---
applyTo: "scripts/sync-notes.mjs,scripts/blog.config.mjs,content/**"
---

Read `docs/ARCHITECTURE.md` before changing publication behavior.

- Obsidian source and sync rules are authoritative; generated `content/` files are not editing sources.
- Preserve the distinction between polished blog posts and networked public notes.
- Discover public note collections from eligible top-level Vault directories instead of hard-coding every category. Hidden, system, and explicitly excluded directories stay private; Markdown requires `publish: true` before it can enter the public notes build.
- Treat `publish: true` as the public-notes gate and exact `type: post` as the blog gate. `blog.config.mjs` may supply presentation metadata for a post, but it must never force a `type: note` file into the blog.
- Keep source commit, copied/unchanged counts, public markers, slugs, and asset handling observable.
- Blog publication dates use source frontmatter `date` as the canonical value, with `created` and `createdAt` as compatibility fallbacks, then the note repository's first Git commit. Listings, article metadata, RSS, social images, and SEO must consume that one resolved value. `modified`, `updated`, and `updatedAt` remain update metadata and never replace it.
- Never use checkout or generated-file timestamps as public dates.
- Derive reaction identity from the source note path, not a generated URL. Emit the blog and notes route aliases together so title, body, frontmatter, or blog slug changes preserve likes and views. A source-file rename requires an explicit migration alias.
- After changes run `npm run sync`, `npm test`, `npm run build`, and `npm run quality:build`.

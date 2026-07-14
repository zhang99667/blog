---
mode: agent
description: Prepare, activate, rotate, or restore the encrypted MarkZ runtime backup path.
---

# Runtime Backup

1. Read `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, decisions D-014 and D-021, and `ai/evolution.json`.
2. Run `npm run evolve:report` and inspect the current local backup health before changing the off-site path.
3. Never create a new encryption identity, enable external storage, rotate recipients, or replace production data without explicit user approval.
4. Keep the private age identity outside the repository, server, and GitHub Actions. Only public recipients may enter `deploy/runtime-backup-recipient.txt`.
5. Keep the workflow approval-gated by `MARKZ_RUNTIME_BACKUP_ENABLED`; upload only `.age` ciphertext and its checksum.
6. Require source snapshot verification, encryption, an ephemeral-recipient decrypt round trip, and an isolated SQLite restore before upload.
7. For recovery, restore to a new path, verify it, preserve the live database and WAL sidecars, then request approval before any production replacement.
8. After the first successful download restore, record run ID, artifact ID and digest, source commit, recipient SHA-256, retention, and the restore result in `ai/runtime-backup-activation.json`.
9. Run `npm test`, `npm run evals:check`, `npm run evolve:report`, and the complete deployment gates required by the change.

Do not reuse deployment or personal SSH private keys as backup encryption identities, upload plaintext SQLite, or mark the capability achieved while activation evidence is missing.

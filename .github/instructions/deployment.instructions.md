---
applyTo: "deploy/**,scripts/deploy.mjs,scripts/runtime-backup/**,.github/workflows/markz-backup.yaml"
---

Read `docs/OPERATIONS.md` and deployment decisions in `docs/AI-DECISIONS.md` before editing.

- `markz-edge` is the only owner of host ports 80 and 443.
- Do not write into the JSONUtils Compose project or restore a blog override there.
- Keep credentials outside the repository.
- Keep production SSH host keys pinned in `deploy/known_hosts`; never replace a mismatch with a live `ssh-keyscan` result without trusted-console verification.
- Keep runtime backup activation behind explicit approval and `MARKZ_RUNTIME_BACKUP_ENABLED`; only public age recipients may enter the repository.
- Upload only encrypted `.age` artifacts and checksums after a decrypt-and-restore drill. Never reuse deployment SSH keys as encryption identities.
- Keep shared security header values in `deploy/security-headers.inc`; every TLS server and location with its own `add_header` must include it.
- Keep the editorial CSP value and exact host scope in the `$markz_content_security_policy` map in `deploy/nginx.conf`; its default must stay empty so product applications retain CSP ownership.
- Require Nginx config validation, all-domain smoke checks, and remote port ownership evidence.
- Deployment changes are high risk and must run the complete verification gate.

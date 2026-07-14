---
applyTo: "deploy/**,scripts/deploy.mjs"
---

Read `docs/OPERATIONS.md` and deployment decisions in `docs/AI-DECISIONS.md` before editing.

- `markz-edge` is the only owner of host ports 80 and 443.
- Do not write into the JSONUtils Compose project or restore a blog override there.
- Keep credentials outside the repository.
- Keep shared security header values in `deploy/security-headers.inc`; every TLS server and location with its own `add_header` must include it.
- Keep the editorial CSP value and exact host scope in the `$markz_content_security_policy` map in `deploy/nginx.conf`; its default must stay empty so product applications retain CSP ownership.
- Require Nginx config validation, all-domain smoke checks, and remote port ownership evidence.
- Deployment changes are high risk and must run the complete verification gate.

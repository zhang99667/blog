---
mode: agent
description: Select and complete the highest-value evidence-backed MarkZ maturity improvement.
---

# Evolve MarkZ

1. Read `AGENTS.md`, `ai/manifest.json`, `ai/evolution.json`, and the project Skill.
2. Run `npm run evolve:report` and inspect the evidence for the first ranked gap.
3. Treat a recorded decline as binding. D-022 stays visible and unachieved but outside the ranked queue; do not request approval or reopen it unless the user later 明确反转 D-022.
4. Re-check the cited source and runtime state. A detector is evidence, not permission to trust a stale assumption.
5. If the item requires a new external service or secret, privacy expansion, destructive behavior, or a critical production change, obtain explicit user approval. Otherwise implement it end to end.
6. Add or strengthen the deterministic probe, focused tests, documentation, and decision record needed to keep the capability achieved.
7. Run the validation commands declared by that capability, then the repository gates required by its risk.
8. Run `npm run evolve:report` again. The completed item must move to “achieved”; report the next ranked gap instead of silently expanding scope.

Do not lower a score, weaken a detector, or mark an incomplete capability achieved to make the report green.

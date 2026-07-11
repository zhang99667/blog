# Diagnose a public routing incident

Treat routing incidents as high risk. Read [operations](../../docs/OPERATIONS.md), [architecture](../../docs/ARCHITECTURE.md), and deployment decisions.

1. Capture DNS/SNI HTTP results for every public host.
2. Inspect container host-port bindings and prove which container owns 80/443.
3. Inspect the active edge config and logs before changing files.
4. Make the smallest ownership-preserving fix and validate Nginx before restart.
5. Re-run all-domain smoke checks, API health, and port ownership checks.
6. Turn a new failure mode into a decision and deterministic gate.

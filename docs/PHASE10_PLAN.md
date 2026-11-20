# Phase 10 audit and implementation plan

The existing anomaly worker labels itself AI-based but implements fixed rules. It infers geography from a join across a user's active sessions, assumes UTC office hours, and uses a check-then-insert deduplication query. There is no authentication failure store, confidence explanation, evidence history or incident state beyond a resolved boolean.

1. Add tenant-scoped, minimal detection signals, evidence, rule-worker status and incident review history through a migration. Keep legacy anomaly routes and rows compatible.
2. Record authentication failures, authenticated source observations, device identifier changes, policy denials, known-session source-gate rejection and selected client reports. Exclude credentials, private VPN keys, raw addresses and full URLs from new evidence.
3. Run deterministic versioned rules with explicit windows and thresholds, atomic evidence consumption and one open incident per subject/rule. Preserve the existing explicit worker flag and organization allowlist.
4. Add revision-checked review, manual containment and tenant-authorized notifications to the existing console.
5. Evaluate labeled synthetic rule fixtures and document false positives, missed signals, reporting latency, retention and deployment limitations. Use real PostgreSQL tests for tenant boundaries, deduplication, rollback and responses.

# ADR 0006: deterministic tenant-scoped detection

Status: accepted in Phase 10.

The former optional worker used fixed UTC-hour and request-count rules, an incorrect multi-session geography join and non-atomic alert deduplication. No representative labeled security dataset exists in the repository.

Use versioned pure rules over minimal durable observations, with database-time windows, explanations, severity and explicitly qualitative confidence. Retain Express, PostgreSQL and the existing opt-in organization allowlist. Add tenant RLS, advisory scan/review locks, one-open-incident uniqueness, immutable evidence consumption and revision-checked manual incident responses. Keep network access enforcement independent. Client reports remain untrusted; no automatic containment follows a rule hit.

An incident is also the durable administrator queue. Use the existing live-authorized Socket.IO channel for best-effort in-app notifications without adding brokers, mail providers or invented credentials. A bounded worker exposes overload and failure instead of reporting complete coverage. Synthetic evaluation includes known confounders and unavailable telemetry; it does not validate production accuracy. Defer ML until suitable labeled data, privacy review and a separately validated evaluation exist.

Consequences: the same observation may legitimately trigger more than one rule. Retention cleanup depends on successful enabled scans; immutable review history needs an operator archive/deletion policy. Signal-write failures affect availability when enabled. Fingerprint-key rotation interrupts correlation. PostgreSQL per-tenant serialization favors consistency over throughput; revisit only after measured requirements. See [operations and limitations](../DETECTION_AND_RESPONSE.md).

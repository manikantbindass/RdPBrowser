# Phase 04 — backend reliability and tenant isolation

## Audit before changes (2026-11-12)

Inspected Express composition, auth/admin/proxy routes, PostgreSQL schema and migration runner, realtime authorization, anomaly worker, configuration, logging, lifecycle, unit/integration suites and architecture CI. Baseline: 42/42 unit tests pass outside the restricted loopback sandbox. Initial sandbox run failed 21 HTTP tests with EACCES; this is an execution restriction, not a passing result. Docker initially stopped.

Confirmed defects: all admin data is global; no tenant columns or database isolation; registration returns unusable access tokens; refresh credentials have no stored revocation/rotation state; concurrent logins race the session cap; authorization trusts stale JWT roles/account state; admin mutations lack atomic audit writes and typed identifiers; unbounded lists and permissive pagination; unsafe regex interpretation of URL patterns; realtime rooms mix tenants and force-logout only broadcasts. No device registry, policy revision interface, security-event intake or OpenAPI spec exists. Existing request IDs, safe error envelopes, config checks, health/readiness and bounded shutdown will be retained.

## Implementation sequence

1. Add an additive migration adopting legacy rows into the default organization; composite tenant foreign keys, indexes and forced PostgreSQL row-level security. Require a restricted runtime role distinct from migration credentials.
2. Establish an explicit tenant context at service/query boundaries and transactional helpers; validate live account/session state. Repair registration, single-use refresh rotation and concurrent session limits.
3. Complete bounded tenant-scoped user/device/session/policy/event interfaces; preserve legacy admin/auth response keys and aliases. Audit critical mutations in the same transaction.
4. Align realtime and anomaly workers with tenant isolation; unify URL policy evaluation and structured redaction.
5. Publish OpenAPI and upgrade/provisioning instructions. Run lint, unit, real PostgreSQL migrations/API/negative-isolation/concurrency tests and dependency checks. Record failures or unavailable checks explicitly before commit/push.

## Acceptance

Two-tenant negative tests must reject cross-tenant reads, writes, references, sessions, policies and events, including direct SQL under the runtime role. Migration replay, adoption, atomic rollback, refresh replay, revocation and bounded queries need real PostgreSQL evidence. No mock-only isolation claim. Public registration remains default-organization-only and is disabled by default in production; organization provisioning stays operator-controlled. Database operators and migration credentials remain trusted infrastructure boundaries.

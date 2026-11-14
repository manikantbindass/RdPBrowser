# ADR 0003: portable schemas and additive API evolution

Status: accepted in Phase 02.

Use [JSON Schema 2020-12](https://json-schema.org/understanding-json-schema/reference) documents in contracts/ as language-neutral DTO/request contracts. Backend uses explicit locked Ajv/Ajv-formats dependencies; Rust/Dart remain independent and may adopt native validators/generated types later. Do not import npm packages into Flutter/Rust or create cross-runtime builds. Existing Joi registration validation is retained during incremental migration; login and navigation body validation now execute shared schemas. Passwords/keys/token hashes are not public domain DTO fields.

/api/v1 is canonical for new clients. /api remains a compatibility alias with the same handlers/status codes, existing success shapes and legacy error string. Error responses add code and server-generated requestId; X-Request-ID correlates logs. No sunset date is invented. Breaking changes require a new major path, migration guide and client overlap window. Unsupported numeric versions return a structured404. Additive response fields must be tolerated by clients; request schemas remain strict. Existing error codes take precedence over default HTTP category codes.

Organization/device/policy/event schemas define target domain boundaries, not a tenant API or persisted tenant security. Nullable organizationId/user and session deviceId represent transitional legacy mappings, not permission to infer tenant access. Before implementing tenant APIs: add migrations, authorization and cross-tenant tests. Event contracts specify versioned envelopes but no message broker or durable delivery is claimed.

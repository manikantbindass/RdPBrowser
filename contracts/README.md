# Shared contract boundary

http.schema.json defines executed login/navigation requests and API error/metadata responses. domain.schema.json defines future organization/user/device/session/policy/event DTOs. Backend uses Ajv2020 with formats and no coercion. Tests compile all definitions and check API responses. Requests reject unknown fields; response schemas allow additive evolution. Schema IDs and DTO revision fields are independent of database migration versions.

| Model | Ownership / identifier | Current persistence mapping | Future acceptance |
|---|---|---|---|
| Organization | Control plane; UUID, name, status, monotonic revision | Not persisted yet | Tenant schema and isolation tests before API exposure |
| User | Identity; UUID, organizationId (nullable legacy), username, role/status | users; status projects is_active/is_locked; no organization column yet | Enrollment, account/role lifecycle and organization membership migration |
| Device | Enrollment; UUID, organization/user references, platform, trustState | Only untrusted legacy users.device_id/sessions.device_id text exists | Device registry/attestation adapter and revocation tests |
| Session | Identity; UUID,user/device references,status,expiresAt | sessions, with token hash kept internal; legacy device text cannot be blindly cast to UUID | Token-family rotation, current-role/lock validation and device lifecycle |
| Policy | Policy service; UUID,organizationId,revision,mode,rules | Legacy global blocked_urls/allowed_urls, no organization or policy revision | Versioned policy persistence, matching semantics and enforcement acknowledgment |
| Event | Audit boundary; UUID,type,schemaVersion,time,actor/organization,data | Existing audit_log/anomaly rows are legacy records, not this envelope | Redaction, retention, delivery/idempotency and authorization contract |

No organization/device/policy CRUD endpoints or tenant guarantees are introduced in Phase 02. Do not label client-supplied IDs or health probes as trusted evidence. Rust uses url validation for its control-plane origin; Dart/TypeScript have independent endpoint adapters. Adopt these DTOs incrementally with native types; no npm dependency or code generator is forced on either runtime.

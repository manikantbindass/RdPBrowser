# API reference

Use the [OpenAPI 3.1 specification](../contracts/openapi.json) as the machine-readable contract. The public HTTP major is `v1`. The specification `info.version` identifies the schema document. The catalogue below is generated from all 102 operations in the reviewed contract; schemas remain authoritative for payloads, scopes, filters, and responses.

## Base URLs and access

| Surface | URL and requirements |
| --- | --- |
| Control plane | `/api/v1` is canonical. Existing `/api` aliases share legacy handlers and return a successor link. Unsupported numeric majors return `API_VERSION_UNSUPPORTED`. |
| Health and readiness | `GET /health` and `GET /ready` are root paths. Readiness checks DB role and migration state and may return 503. |
| SCIM | `/scim/v2/{organizationId}` uses a scoped directory credential, separate parser and limits. Restrict its ingress at the edge. |
| Realtime | `/socket.io` uses handshake `auth.token`; live session, organization-room and operation authorization are checked server-side. |
| Navigation | `POST /api/v1/proxy/navigate` evaluates a URL. The native WebView performs the site request. |

Send UTF-8 JSON and documented content type. Use `Authorization: Bearer <access-token>` for protected operations. The server derives tenant context from the verified session. Administrative and provisioning operations add role or scope checks. Source-address restrictions can be an additional gate, never a replacement for identity authorization. [Security model](SECURITY_MODEL.md)

## Session usage, limits, and errors

- `POST /api/v1/auth/login` accepts username, password and optional organization UUID.
- `POST /api/v1/auth/refresh` rotates the refresh credential. Serialize refresh requests. A lost rotation response or revocation can require a fresh sign-in.
- `POST /api/v1/auth/logout` revokes the current authenticated session.
- Pagination defaults to page 1 and 50 rows, with a 100 row cap where the shared pager applies. Individual endpoint schemas define supported filters and other limits.
- Errors contain `error`, `code` and `requestId`. Propagate `X-Request-ID` when contacting support. Typical outcomes include 400 validation, 401 authentication, 403 authorization/source denial, 404 inaccessible resource, 409 revision conflict, 429 rate limit and 503 readiness/capacity. SCIM uses its own schema.

## Contract operations

The table lists method, exact path and contract summary for every operation. “Bearer” reflects the OpenAPI security declaration; review the operation schema and server checks for additional role, tenant, source, or SCIM scope requirements. Contract and runtime drift must be tested before release.

### Metadata and authentication

| Method | Path | Contract summary | OpenAPI security |
| --- | --- | --- | --- |
| `GET` | `/meta` | API metadata | Public/flow-specific |
| `GET` | `/network/status` | Report the server-observed connection source | Public/flow-specific |
| `POST` | `/auth/register` | Register in the default organization (deployment flag) | Public/flow-specific |
| `POST` | `/auth/login` | Login (organizationId optional for legacy organization) | Public/flow-specific |
| `POST` | `/auth/refresh` | Rotate a stored single-use refresh credential | Public/flow-specific |
| `POST` | `/auth/logout` | Revoke access and refresh session | bearerAuth |
| `GET` | `/organization` | Current organization | bearerAuth |
| `GET` | `/auth/status` | Own live session and device bootstrap status; does not grant content access | bearerAuth |
| `POST` | `/auth/status` | Own session plus bounded URL re-evaluation for native policy monitor | bearerAuth |
| `GET` | `/auth/oidc/{provider}/start` | Start browser-bound confidential OIDC authorization code flow | Public/flow-specific |
| `GET` | `/auth/oidc/{provider}/callback` | Consume one-use state/code and issue local tokens only for an explicit identity link | Public/flow-specific |
| `POST` | `/auth/oidc/{provider}/console-session` | Exchange the one-use console handoff bound to the configured origin | Public/flow-specific |
| `GET` | `/laila/search` | Public external search adapter | Public/flow-specific |

### Access decisions and devices

| Method | Path | Contract summary | OpenAPI security |
| --- | --- | --- | --- |
| `POST` | `/access/evaluate` | Evaluate a server-defined resource with live identity/session/device context | bearerAuth |
| `POST` | `/devices/{id}/key` | Enroll an immutable owner P-256 public key; unknown trust until admin approval | bearerAuth |
| `POST` | `/devices/{id}/challenge` | Issue session-bound one-use five-minute device possession challenge | bearerAuth |
| `POST` | `/devices/{id}/proof` | Prove ECDSA-SHA256-DER key possession; this is not hardware attestation | bearerAuth |
| `GET` | `/devices` | List own devices; admins list organization devices | bearerAuth |
| `POST` | `/devices` | Register own device; this is not device attestation | bearerAuth |
| `DELETE` | `/devices/{id}` | Revoke own or admin-visible device and associated sessions | bearerAuth |

### Users and sessions

| Method | Path | Contract summary | OpenAPI security |
| --- | --- | --- | --- |
| `POST` | `/users` | Register an ordinary user in the admin organization | bearerAuth |
| `GET` | `/sessions` | List own sessions; admins list organization sessions | bearerAuth |
| `DELETE` | `/sessions/{id}` | Revoke own or admin-visible session | bearerAuth |

### Policies, events and navigation

| Method | Path | Contract summary | OpenAPI security |
| --- | --- | --- | --- |
| `GET` | `/policies` | List organization policy revisions | bearerAuth |
| `POST` | `/policies` | Create policy | bearerAuth |
| `PUT` | `/policies/{id}` | Update policy using expected revision | bearerAuth |
| `POST` | `/policies/evaluate` | Evaluate active policy snapshot (deny wins) | bearerAuth |
| `POST` | `/events` | Ingest untrusted client event; idempotent per user/clientEventId | bearerAuth |
| `GET` | `/events` | List organization security events | bearerAuth |
| `POST` | `/proxy/navigate` | Legacy navigation decision and activity record | bearerAuth |
| `GET` | `/proxy/check` | Legacy URL decision with identical policy semantics | bearerAuth |

### Administration and incident response

| Method | Path | Contract summary | OpenAPI security |
| --- | --- | --- | --- |
| `GET` | `/admin/access-policy` | Get effective organization access policy and revision | bearerAuth |
| `PUT` | `/admin/access-policy` | Replace access policy using expected revision; bootstrap safety checks apply | bearerAuth |
| `POST` | `/admin/identity-links` | Link a preexisting local user to exact operator-configured issuer/subject | bearerAuth |
| `DELETE` | `/admin/identity-links/{id}` | Unlink identity and revoke enterprise sessions | bearerAuth |
| `GET` | `/admin/access-decisions` | List server-owned organization authorization decisions | bearerAuth |
| `GET` | `/admin/audit-log` | List tenant audit records with an optional exact action code | bearerAuth |
| `GET` | `/admin/security-summary` | Seven UTC days of recorded server denials and client reports | bearerAuth |
| `GET` | `/admin/network-health` | Current console source admission and recent tenant URL source observations | bearerAuth |
| `GET` | `/admin/devices` | List enrolled device metadata and public-key presence | bearerAuth |
| `GET` | `/admin/policies` | List all organization URL policies and their assignments | bearerAuth |
| `GET` | `/admin/policies/{id}/versions` | List append-only policy and assignment revisions | bearerAuth |
| `PATCH` | `/admin/users/{id}/role` | Superadmin changes a lower role and revokes sessions | bearerAuth |
| `GET` | `/admin/account` | Read own administrator profile and session details | bearerAuth |
| `PUT` | `/admin/account/password` | Verify the current password, change it and revoke all own sessions | bearerAuth |
| `PATCH` | `/admin/devices/{id}/trust` | Update posture trust; revoked devices cannot be restored | bearerAuth |
| `GET` | `/admin/sessions` | Legacy tenant sessions | bearerAuth |
| `GET` | `/admin/blocked-urls` | Legacy tenant blocked-urls | bearerAuth |
| `POST` | `/admin/blocked-urls` | Upsert legacy tenant deny rule | bearerAuth |
| `GET` | `/admin/anomalies` | Legacy tenant anomalies | bearerAuth |
| `GET` | `/admin/users` | Search organization users by literal name or email substring | bearerAuth |
| `GET` | `/admin/ip-logs` | Tenant activity logs | bearerAuth |
| `GET` | `/admin/stats` | Tenant dashboard counts | bearerAuth |
| `GET` | `/admin/detection-rules` | Versioned deterministic rules and tenant worker health | bearerAuth |
| `GET` | `/admin/alerts` | Tenant incident queue; defaults to open incidents | bearerAuth |
| `GET` | `/admin/alerts/{id}` | Incident explanation, confidence, revision and evidence count | bearerAuth |
| `GET` | `/admin/alerts/{id}/evidence` | Append-only redacted detection evidence | bearerAuth |
| `GET` | `/admin/alerts/{id}/reviews` | Append-only review and manual response history | bearerAuth |
| `PATCH` | `/admin/alerts/{id}/review` | Revision-checked review; closed states require a nonpending disposition | bearerAuth |
| `POST` | `/admin/alerts/{id}/respond` | Manual containment subject to existing administrator role hierarchy | bearerAuth |
| `POST` | `/admin/force-logout` | Revoke sessions atomically with audit | bearerAuth |
| `DELETE` | `/admin/blocked-urls/{id}` | Deactivate legacy deny rule | bearerAuth |
| `PATCH` | `/admin/anomalies/{id}/resolve` | Resolve tenant anomaly | bearerAuth |
| `PATCH` | `/admin/users/{id}/lock` | Lock user and revoke sessions; unlock never revives old sessions | bearerAuth |

### Enterprise integrations and governance

| Method | Path | Contract summary | OpenAPI security |
| --- | --- | --- | --- |
| `GET` | `/admin/integrations/oidc` | List sanitized tenant identity-provider configuration and activation state | bearerAuth |
| `POST` | `/admin/integrations/oidc/{provider}/validate` | Superadmin validates discovery metadata for the configured provider | bearerAuth |
| `PUT` | `/admin/integrations/oidc/{provider}/state` | Superadmin activates or disables a provider using its revision | bearerAuth |
| `GET` | `/admin/integrations/directories` | List tenant directory connections and SCIM base location | bearerAuth |
| `POST` | `/admin/integrations/directories` | Superadmin creates a directory connection | bearerAuth |
| `PATCH` | `/admin/integrations/directories/{id}` | Superadmin updates directory state and revokes access on disable | bearerAuth |
| `GET` | `/admin/integrations/directories/{id}/credentials` | List provisioning credential metadata without secrets | bearerAuth |
| `POST` | `/admin/integrations/directories/{id}/credentials` | Superadmin issues a provisioning credential and sees the secret once | bearerAuth |
| `DELETE` | `/admin/integrations/credentials/{id}` | Superadmin revokes a provisioning credential | bearerAuth |
| `GET` | `/admin/integrations/groups` | List managed directory groups | bearerAuth |
| `PATCH` | `/admin/integrations/groups/{id}/mapping` | Superadmin maps a group to user or admin and revokes affected sessions | bearerAuth |
| `GET` | `/admin/governance/changes` | List recorded administrative changes | bearerAuth |
| `GET` | `/admin/governance/device-compliance` | List registry posture status and evidence provenance | bearerAuth |
| `POST` | `/admin/governance/exports` | Export an audited, bounded evidence page with integrity digest | bearerAuth |
| `GET` | `/admin/governance/reviews` | List access review campaigns | bearerAuth |
| `POST` | `/admin/governance/reviews` | Snapshot active accounts and their entitlements for independent review | bearerAuth |
| `GET` | `/admin/governance/reviews/{id}/items` | List snapshot and decision state for review items | bearerAuth |
| `POST` | `/admin/governance/reviews/{id}/close` | Close a review after all decisions are recorded | bearerAuth |
| `PATCH` | `/admin/governance/reviews/{id}/items/{itemId}` | Record an independent access-review decision and revoke application access if selected | bearerAuth |
| `POST` | `/admin/governance/reviews/{id}/items/{itemId}/refresh` | Refresh the current entitlement snapshot while keeping prior decision evidence | bearerAuth |

### SCIM 2.0 provisioning

| Method | Path | Contract summary | OpenAPI security |
| --- | --- | --- | --- |
| `GET` | `/scim/v2/{organizationId}/ServiceProviderConfig` | Read SCIM discovery metadata | scimBearer |
| `GET` | `/scim/v2/{organizationId}/ResourceTypes` | Read SCIM discovery metadata | scimBearer |
| `GET` | `/scim/v2/{organizationId}/Schemas` | Read SCIM discovery metadata | scimBearer |
| `GET` | `/scim/v2/{organizationId}/Schemas/{schemaId}` | Read SCIM discovery metadata | scimBearer |
| `GET` | `/scim/v2/{organizationId}/Users` | List directory-owned users | scimBearer |
| `POST` | `/scim/v2/{organizationId}/Users` | Create a directory-owned resource | scimBearer |
| `GET` | `/scim/v2/{organizationId}/Users/{id}` | Read a directory-owned resource | scimBearer |
| `PUT` | `/scim/v2/{organizationId}/Users/{id}` | Replace supported attributes | scimBearer |
| `PATCH` | `/scim/v2/{organizationId}/Users/{id}` | Apply bounded SCIM PatchOp operations | scimBearer |
| `DELETE` | `/scim/v2/{organizationId}/Users/{id}` | Soft-delete and revoke affected access | scimBearer |
| `GET` | `/scim/v2/{organizationId}/Groups` | List directory-owned groups | scimBearer |
| `POST` | `/scim/v2/{organizationId}/Groups` | Create a directory-owned resource | scimBearer |
| `GET` | `/scim/v2/{organizationId}/Groups/{id}` | Read a directory-owned resource | scimBearer |
| `PUT` | `/scim/v2/{organizationId}/Groups/{id}` | Replace supported attributes | scimBearer |
| `PATCH` | `/scim/v2/{organizationId}/Groups/{id}` | Apply bounded SCIM PatchOp operations | scimBearer |
| `DELETE` | `/scim/v2/{organizationId}/Groups/{id}` | Soft-delete and revoke affected access | scimBearer |

### Health

| Method | Path | Contract summary | OpenAPI security |
| --- | --- | --- | --- |
| `GET` | `/health` | Process liveness | Public/flow-specific |
| `GET` | `/ready` | Database role/schema readiness; 503 while draining | Public/flow-specific |

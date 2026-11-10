# Control-plane API v1

New clients use /api/v1; /api aliases the same legacy handlers. Existing clients retain success fields and HTTP status behavior. Requests/responses are UTF-8 JSON, except Socket.io's transport/client assets. No major-version sunset is scheduled. Unknown numeric major versions return404/API_VERSION_UNSUPPORTED. This is the current route inventory, not a claim that all request schemas or security flows have been repaired.

| Relative route | Method | Access / contract |
|---|---|---|
| /meta | GET, v1 only | Public metadata; http.schema metadata; enforcement reported as external |
| /laila/search?q=... | GET | Existing public search adapter; no VPN gate; upstream reliability remains a tracked gap |
| /auth/register | POST | Configured API source filter; existing Joi username/email/password/device validation; registration-session defect remains |
| /auth/login | POST | Source filter; shared loginRequest schema; returns existing user/accessToken/refreshToken/expiresAt shape |
| /auth/refresh | POST | Source filter; existing refreshToken body; rotation/session persistence remains incomplete |
| /auth/logout | POST | Source filter; existing bearer token hash invalidation |
| /proxy/navigate | POST | Source filter + active bearer session; shared navigateRequest; returns existing allowed/url/serverIp decision, not proxied content |
| /proxy/check?url=... | GET | Source filter + active session; legacy blocklist check; known rule parity gap remains |
| /admin/sessions, /admin/stats, /admin/users | GET | Source filter + active session + admin/superadmin role |
| /admin/ip-logs?page=&limit=&flagged= | GET | Same admin gates; {logs,total,page,limit}; filtered count alias repaired in Phase01 |
| /admin/force-logout | POST | Admin gates; existing userId or sessionId body invalidates DB sessions |
| /admin/blocked-urls | GET,POST | Admin gates; existing pattern/reason validation |
| /admin/blocked-urls/:id | DELETE | Admin gates; soft deactivation |
| /admin/anomalies | GET | Admin gates; unresolved legacy alert rows |
| /admin/anomalies/:id/resolve | PATCH | Admin gates; resolve legacy alert |
| /admin/users/:id/lock | PATCH | Admin gates; existing locked field handling; validation/current-state revocation gaps remain |

Outside the versioned namespace: GET /health is process liveness; GET /ready verifies PostgreSQL and known migration history. Neither proves a VPN tunnel or end-to-end policy enforcement.

Errors preserve error:string, add a stable category code when absent, and include a server-owned UUID requestId matching X-Request-ID. Optional details contain safe field paths/rules, never values. Existing codes (for example SESSION_EXPIRED and VPN_REQUIRED) remain. Generic categories include BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, PAYLOAD_TOO_LARGE, RATE_LIMITED, INTERNAL_ERROR and UNAVAILABLE. JSON parse and internal DB failures do not expose parser bodies, SQL or credentials. Consumers must tolerate additive fields and should branch on code rather than message text.

Socket.io remains at /socket.io with handshake auth.token. The existing admin events remain; administrative room/actions recheck session identity/role. Optional SSH events remain development-only, default-off, without production host/destination guarantees. WebSocket upgrade does not inherit Express middleware; its explicit adapter is required. No event envelope is claimed durable until future delivery/idempotency work is implemented.

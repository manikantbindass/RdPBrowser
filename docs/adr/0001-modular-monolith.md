# ADR 0001: retain one deployable backend with explicit modules

Status: accepted in Phase 02. Context: no measured concurrency, latency or independent scaling requirement justifies distributed state, queues or extra services.

Decision: retain Express/Node/PostgreSQL and Socket.io in one backend process. http/app.js composes HTTP; runtime.js owns lifecycle; realtime owns Socket.io and the optional development SSH adapter; db owns the pool and migrations; config/logging/contracts own shared process concerns. Legacy routes remain incremental adapters to the existing SQL facade. Security utilities depend inward on backend persistence, never on desktop/Flutter/UI code.

Desktop (Tauri/Rust/React), Android (Flutter/Dart) and admin are separate clients, not backend libraries. contracts/ contains portable JSON documents only. Docker/Nginx deploy the control plane; vpn-server contains explicitly privileged network provisioning. No client imports a backend module. No backend imports client UI code.

Consequences: maintain existing deployable and client compatibility; preserve one transaction boundary and avoid distributed consistency costs. HTTP tests can construct an app without a listener or DB connection. Runtime owns clean shutdown and optional detector cleanup. Legacy SQL route handlers are not advertised as a complete domain/service refactor. Revisit process separation only with measured bottlenecks, resource/latency targets and a state-consistency design.

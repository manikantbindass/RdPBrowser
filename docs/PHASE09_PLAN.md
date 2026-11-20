# Phase 09 admin console audit and plan

The existing static console signs in with a password, lists sessions and IP activity, locks accounts, manages the legacy URL block list, and resolves anomalies. It also subscribes to tenant-scoped Socket.IO notifications. It draws several API-provided fields using HTML strings, treats socket connectivity as VPN health, and silently discards some load failures. It has no device inventory, persistent policy history, assignment editor, role editor or administrative audit viewer.

1. Preserve the current Nginx static deployment, REST aliases, existing operational actions and authorized real-time updates.
2. Add administrator-only inventory, chart aggregates, source observations and audit reads. Back role changes and password rotation with database transactions, session revocation and audit entries.
3. Migrate URL policies to organization or user assignments. Use authenticated identity during evaluation, preserve old behavior for existing organization rules and append an immutable revision after each edit.
4. Build a keyboard-accessible, responsive console. Use separate loading, empty, failure and denied states. Render names, codes and patterns as text.
5. Validate restricted database roles and tenant isolation against PostgreSQL. Exercise the real console in Chromium at desktop and mobile widths, including rendering hostile text and applying actions with the backend.

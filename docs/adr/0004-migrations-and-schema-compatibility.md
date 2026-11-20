# ADR 0004: explicit checksum-verified migrations

Status: accepted in Phase 02.

Replace startup DDL with npm run migrate, executed once before serving. Ordered NNN_name.sql files are immutable after application. schema_migrations records version, normalized-LF SHA-256 and timestamp. One transaction and transaction-scoped [PostgreSQL advisory lock](https://www.postgresql.org/docs/15/explicit-locking.html#ADVISORY-LOCKS) serialize migration runners; a lock timeout bounds wait. On error, rollback DDL/history together and release the connection. No automatic destructive down migration.

001_initial.sql preserves the existing tables/schema. It is idempotent and can adopt a matching legacy installation while preserving rows; verified against real PostgreSQL. For an existing deployment, back up and compare its schema with the migration before adoption: CREATE TABLE IF NOT EXISTS does not prove arbitrary existing constraints/types match. Unknown, edited or sparse migration history fails closed. Server initialization is read-only and refuses pending/mismatched history. Readiness checks dependency/schema compatibility; liveness remains independent.

Future changes follow expand/migrate/contract: add nullable/new structures first, deploy code able to read old/new representations, backfill with explicit progress/checks, then enforce/remove in a later reviewed migration. Older binaries refuse unknown migration versions in this initial strict policy; forward-compatible rollout requires an explicit compatible-version policy before mixed-binary deployment. Do not claim rolling schema compatibility without tests. Runtime/migrator use the same DB credential in the local stack; production role separation/DDL grants are an operational hardening follow-up.

Recovery: preserve backups and a tested restore path; fix forward whenever safe. If data rollback is required, review newer-write loss explicitly. Never delete volumes or silently re-stamp edited checksums. New auth tokens include unique jti values to avoid same-second collisions; no schema change or full refresh-rotation claim accompanies that repair.

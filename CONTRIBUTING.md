# Contributing

Start with [local development](docs/LOCAL_DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md) and [the defect register](docs/BUG_REGISTER.md). Preserve the existing stack and working behavior. Keep changes scoped; describe the concrete problem, resulting behavior, tests and remaining limitations.

1. Create a branch and inspect the current implementation before changing it.
2. Keep API compatibility or document a migration; use explicit database migrations for schema changes.
3. Add meaningful unit/integration/platform tests. Run relevant lint, build and test commands; never suppress failures to obtain a green check.
4. Update status/security/platform documentation when behavior changes. Distinguish source presence, compilation and actual runtime verification.
5. Open a pull request with test results, known blockers and screenshots only from real running interfaces. Do not merge until review and required checks pass.

For README media, preserve original sources and provenance. Use scripts/build_readme_assets.py and scripts/validate_readme.py. Screenshot changes need capture date, commit, application/view, data mode and limitations in assets/readme/SCREENSHOTS.md. Do not fabricate missing screens or edit captures to imply working features.

Do not include credentials, real customer records or private logs. Follow [SECURITY.md](SECURITY.md) for vulnerability reports. Licensing metadata is currently incomplete; the repository owner must resolve the missing standalone license text rather than contributors inventing terms.

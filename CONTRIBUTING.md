# Contributing to RemoteShield X

Start with [getting started](docs/GETTING_STARTED.md), [architecture](docs/ARCHITECTURE.md) and [testing](docs/TESTING.md). Keep changes focused and preserve supported API and deployment behavior. Raise a proposed behavior or schema change in the pull request and document how current installations adopt it.

1. Branch from the source revision under review. Keep lockfiles consistent and use a forward migration for database changes.
2. Add targeted coverage for changed behavior. Use disposable PostgreSQL, browser, Android and packet fixtures for security-sensitive work. Record the source SHA and which platforms actually ran.
3. Run the relevant lint, build and test commands. Keep required job failures visible. The `Required quality gate` combines the complete PR matrix, including scans.
4. Use focused conventional commits. Open or update a pull request targeting `main` with evidence, compatibility notes and remaining limitations. Review and required checks precede merge.
5. Keep the README, guides and release information aligned with code. Use actual captures with provenance and explicit lab context. Use the [capture ledger](assets/readme/SCREENSHOTS.md) for media updates.

Treat local configuration, customer data, private keys and logs as sensitive. Use the [security policy](SECURITY.md) for vulnerability reporting. The package manifests declare MIT and the standalone licensing record remains for the repository owner to resolve.

# Changelog

## [2.5.0]

- Added organization scoped access policies, session and device lifecycle controls, and an administration console for enrollment, audit events, and security incidents.
- Added desktop and Android managed browsing flows with native navigation checks and a separately administered WireGuard deployment.
- Added required pull-request validation across backend, desktop, Android, network and deployment checks.
- Added versioned desktop installers, Android APKs and Linux AMD64 image archives with CycloneDX inventories and an attested SHA-256 manifest.
- Added an artifact-only preview channel and separate approval gates for distribution signing and publication.
- Updated the desktop build and Rust updater dependencies. Slimmed both runtime images to remove unused package-manager and Nginx module dependencies.
- Added APK package, launcher, version, and target SDK validation. The `v2.4.0` ARM64 APK with the example package ID is a historical asset. See the [download warning](README.md#published-application-downloads).
- Hardened backend file handling and request field lookups, resolved npm advisories, and replaced broad DigitalOcean firewall defaults with explicit networks for WireGuard, web, DNS, and optional time synchronization.
- Release images are available as verified archives. Registry promotion is a separate operator action. This pipeline does not publish the server as an npm package.

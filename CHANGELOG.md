# Changelog

## [2.5.0]

- Added required pull-request validation across backend, desktop, Android, network and deployment checks.
- Added versioned desktop installers, Android APKs and Linux AMD64 image archives with CycloneDX inventories and an attested SHA-256 manifest.
- Added an artifact-only preview channel and separate approval gates for distribution signing and publication.
- Release images are available as verified archives. Registry promotion is a separate operator action. This pipeline does not publish the server as an npm package.

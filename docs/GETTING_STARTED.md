# Getting started

Use the development profile to evaluate the control plane and console on a workstation. It binds loopback ports, permits direct requests and uses disposable local credentials. For a VPN-bound TLS environment, follow [deployment](DEPLOYMENT.md).

## Prerequisites

| Work | Requirements |
| --- | --- |
| Local control plane | Git, Node 24/npm, Docker Engine or Docker Desktop in Linux-container mode, Compose 2.24.4 or later |
| Native desktop | Rust stable with the locked dependency graph, Node 22.12 or later, and the OS-specific Tauri tooling. Windows needs MSVC and WebView2. Linux needs WebKitGTK 4.1 and D-Bus development headers. macOS needs Xcode Command Line Tools. |
| Android | Flutter 3.38.9, Java 17, Android platforms 35 and 36, build tools 35.0.0 and 36.0.0, NDK 28.2.13676358, CMake 3.22.1 |
| Verification | Python 3.10 or later and the dependencies for the selected test suites |

The Android APK minimum is API 26. Evidence for API 36 comes from an emulator. Review the [user guide](USER_GUIDE.md) and [platform testing](TESTING.md) for platform quirks. Use the current [release process](RELEASE_PROCESS.md) for signing and versioning.

## Start the loopback stack

```sh
git clone --branch codex/remoteshield-enterprise-completion https://github.com/manikantbindass/RdPBrowser.git
cd RdPBrowser
node scripts/setup-dev.mjs
npm ci --prefix backend
npm run config:check --prefix backend
docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml config --quiet
docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml up -d --build --wait
curl --fail --show-error http://127.0.0.1:3001/ready
```

On Windows, select the Linux-container context in the current PowerShell process if necessary with `$env:DOCKER_CONTEXT = 'desktop-linux'`. Use `curl.exe` where PowerShell resolves `curl` to an alias. Port 8180 serves the administration console at `http://127.0.0.1:8180/admin/`. Ports 3001 and 5432 publish the dev API and PostgreSQL to loopback.

The setup script creates `backend/.env`, `docker/.env` and `desktop/.env.local` once. Preserve existing files and database credentials when adopting a checkout. Compose waits for PostgreSQL, the one-shot migration task and backend readiness. [existing deployment and recovery guidance](DEPLOYMENT.md)

## Create a test organization and administrator

There is no default administrator. After migrations complete, use a fresh organization UUID and privately inject `ORGANIZATION_ID`, `ORGANIZATION_NAME`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`. The local backend environment file already supplies the owner migration URL. Use an alphanumeric username of at least three characters. The bootstrap password needs 12 to 72 bytes with upper and lowercase letters, a digit and an accepted special character. Avoid shell history or terminal output containing the password.

```sh
npm run organization --prefix backend -- onboard
```

Record the returned organization UUID. Use it and the bootstrap account to sign in to the console. Clear the temporary bootstrap environment afterward. The operator command records an audit entry and rejects duplicate organization IDs. Production onboarding uses a one-shot owner-scoped job. [administrator guide](ADMIN_GUIDE.md)

## Run a client

With the loopback stack active, build or open the desktop app from the repository root:

```sh
npm ci --prefix desktop
npm run build --prefix desktop
npm run tauri:dev --prefix desktop
```

The dev origin is `http://127.0.0.1:3001`. Configure an administrator-provided HTTPS origin for managed installations. Keep `VITE_SERVER_URL` and `REMOTESHIELD_SERVER` aligned where used. These values are public origins.

For an authorized Android emulator in a disposable profile:

```sh
cd android
flutter pub get --enforce-lockfile
flutter run --dart-define=SERVER_URL=http://10.0.2.2:3001
```

The emulator maps `10.0.2.2` to its host. Release builds require an approved HTTPS origin and a managed VPN path. The workflow preview uses a reserved `.invalid` origin and a disposable Android signer.

See [testing](TESTING.md) for fixture prerequisites and [troubleshooting](TROUBLESHOOTING.md) for startup or login failures.

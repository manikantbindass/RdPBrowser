<div align="center">

# 🛡️ RemoteShield X Browser

<img src="./assets/logo.png" width="200" alt="RemoteShield X Logo" style="border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); margin-bottom: 20px;" />

**Enterprise-Grade Secure Remote Work Browser Platform**

[![CI/CD Pipeline](https://github.com/manikantbindass/RdPBrowser/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/manikantbindass/RdPBrowser/actions/workflows/ci.yml)
[[![Latest Release](https://img.shields.io/github/v/release/manikantbindass/RdPBrowser?label=Latest%20Release&color=brightgreen)](https://github.com/manikantbindass/RdPBrowser/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS%20%7C%20Android-brightgreen)](https://github.com/manikantbindass/RdPBrowser/releases)
[![Security](https://img.shields.io/badge/Security-Enterprise%20Grade-red)](https://github.com/manikantbindass/RdPBrowser)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://github.com/manikantbindass/RdPBrowser/pkgs/container/remoteshield-backend)

*All traffic routes through a central VPS with a static IP — tamper-resistant, cross-platform, deployable immediately.*

</div>

---

## 📌 Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [VPN Server Setup](#vpn-server-setup)
- [Desktop Browser (Win/Linux/macOS)](#desktop-browser)
- [Android App](#android-app)
- [Admin Dashboard](#admin-dashboard)
- [Docker Deployment](#docker-deployment)
- [CI/CD](#cicd)
- [Security Model](#security-model)
- [Contributing](#contributing)

---

## 🌐 Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER DEVICES                              │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ Windows Desktop│  │  Linux Desktop   │  │  macOS Desktop  │  │
│  │  (Tauri App)   │  │   (Tauri App)    │  │   (Tauri App)   │  │
│  └───────┬────────┘  └────────┬─────────┘  └────────┬────────┘  │
│          │                   │                       │           │
│          └───────────────────┼───────────────────────┘           │
│                              │ WireGuard Encrypted Tunnel        │
│  ┌───────────────────────────┼───────────────────────────────┐   │
│  │          Android Device   │                               │   │
│  │          (Flutter App)    │                               │   │
│  └───────────────────────────┘                               │   │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │   VPS (Static IP)        │
                    │  ┌────────────────────┐  │
                    │  │   WireGuard VPN    │  │
                    │  │   Kill-Switch ON   │  │
                    │  └────────┬───────────┘  │
                    │           │              │
                    │  ┌────────▼───────────┐  │
                    │  │   Nginx (SSL/TLS)  │  │
                    │  └────────┬───────────┘  │
                    │           │              │
                    │  ┌────────▼───────────┐  │
                    │  │  Node.js Backend   │  │
                    │  │  Express + JWT     │  │
                    │  │  Socket.io         │  │
                    │  └────────┬───────────┘  │
                    │           │              │
                    │  ┌────────▼───────────┐  │
                    │  │    PostgreSQL DB    │  │
                    │  └────────────────────┘  │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │       INTERNET           │
                    └─────────────────────────┘
```

---

## ✅ Features

### 🔒 Security
- All traffic forced through WireGuard VPN tunnel
- Kill-switch: browser auto-blocks if VPN drops
- DevTools disabled (desktop)
- URL whitelist / blacklist
- JWT authentication with device binding
- Root & debug detection (Android)
- App integrity hash verification (all platforms)
- Screenshot prevention (Android `FLAG_SECURE`)
- AI-based anomaly detection

### 🌍 Pre-Compiled Releases & OS Benefits

RemoteShield X is distributed as pre-compiled, production-ready binaries for every major operating system. All artifacts can be downloaded directly from the **GitHub Releases** page of this repository.

| Operating System | Installer Format | Setup Instructions | Benefits & Capabilities |
|------------------|------------------|---------------------|------------------------|
| **Windows** | `.msi`, `.exe` | Download the `.msi` and run the installer. It automatically provisions the WebView2 runtime. | Deep integration with Windows Defender, native OS window rendering, and rapid Edge/WebView engine hardware acceleration. |
| **macOS** | Universal `.dmg` | Mount the `.dmg` and drag `RemoteShield X.app` into your Applications folder. | Universally compiled for both Apple Silicon (M1/M2/M3) and Intel Macs. Sandboxed natively by Gatekeeper with fluid WebKit integration. |
| **Linux** | `.deb`, `.AppImage` | **Ubuntu/Debian**: `sudo dpkg -i app.deb`.<br>**Arch/Fedora**: Run the `.AppImage`. | Unmatched privacy via direct WebKit2GTK compilation. AppImages provide a portable, zero-install secure browsing environment. |
| **Android** | `.apk` (ARM64/ARMv7) | Download to your device. **Fully supports Android 14, 15, 16, and 17**. | Advanced Mobile Security: Natively enforces `FLAG_SECURE` entirely blocking screenshot/screen-recording capabilities globally on all modern APIs. |

### 📊 Admin Dashboard
- Real-time session monitoring
- IP log verification (must match server IP)
- Force logout any session
- Remote URL blocking
- Geo-restriction enforcement
- Offline log sync

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Browser | Tauri 2 + React + TypeScript |
| Android App | Flutter + Dart |
| Backend Gateway | Node.js + Express |
| Realtime | Socket.io |
| Auth | JWT |
| Database | PostgreSQL |
| VPN | WireGuard |
| Reverse Proxy | Nginx |
| Containerization | Docker + Docker Compose |
| CI/CD | GitHub Actions |

---

## 📁 Project Structure

```
RdPBrowser/
├── desktop/                    # Tauri cross-platform browser (Win/Linux/macOS)
│   ├── src/                    # React + TypeScript UI
│   ├── src-tauri/              # Rust backend + window management
│   └── package.json
│
├── android/                    # Flutter Android app
│   ├── lib/
│   │   ├── main.dart
│   │   ├── screens/
│   │   ├── services/
│   │   └── security/
│   └── pubspec.yaml
│
├── backend/                    # Node.js Express API Gateway
│   ├── src/
│   │   ├── routes/
│   │   ├── middleware/
│   │   └── db/
│   ├── .env.example
│   └── package.json
│
├── vpn-server/                 # WireGuard VPN configs + setup
│   ├── setup.sh
│   ├── wireguard/
│   └── client-configs/
│
├── nginx/                      # Nginx reverse proxy
│   └── nginx.conf
│
├── admin-dashboard/            # Admin control panel (HTML/JS)
│   ├── index.html
│   ├── app.js
│   └── styles.css
│
├── security/                   # Security modules
│   ├── integrity-checker/
│   └── anomaly-detector/
│
├── docker/                     # Docker containers
│   ├── docker-compose.yml
│   ├── Dockerfile.backend
│   └── Dockerfile.nginx
│
└── .github/workflows/          # CI/CD pipelines
    └── ci.yml
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 18
- Rust (for Tauri desktop)
- Flutter ≥ 3.0 (for Android)
- Docker + Docker Compose
- A VPS with Ubuntu 22.04 and a **static IP**

### 1. Clone & Configure

```bash
git clone https://github.com/manikantbindass/RdPBrowser.git
cd RdPBrowser

# Copy and fill environment variables
cp backend/.env.example backend/.env
# Edit backend/.env with your PostgreSQL credentials, JWT secret, server IP
```

### 2. Start Backend (Local Dev)

```bash
cd backend
npm install
npm run dev
```

### 3. Start Desktop Browser

```bash
cd desktop
npm install
npm run tauri dev
```

### 4. Build Android APK

```bash
cd android
flutter pub get
flutter build apk --release
```

---

## 🔧 VPN Server Setup

### 1. Provision VPS

Recommended: **DigitalOcean Droplet** or **AWS EC2**
- Ubuntu 22.04 LTS
- Static/Elastic IP assigned
- Open ports: `51820/UDP` (WireGuard), `443/TCP` (Nginx), `22/TCP` (SSH)

### 2. Run Setup Script

```bash
# SSH into your VPS
ssh root@YOUR_SERVER_IP

# Upload and run setup script
scp vpn-server/setup.sh root@YOUR_SERVER_IP:/root/
ssh root@YOUR_SERVER_IP "chmod +x /root/setup.sh && /root/setup.sh"
```

### 3. Configure Clients

Copy `vpn-server/client-configs/windows.conf` (or `linux.conf` / `macos.conf` / `android.conf`) to the respective device and import into WireGuard.

---

## 🖥 Desktop Browser

### Windows
```bash
cd desktop && npm run tauri build
# Output: desktop/src-tauri/target/release/bundle/msi/
```

### Linux
```bash
cd desktop && npm run tauri build
# Output: desktop/src-tauri/target/release/bundle/deb/ or .AppImage
```

### macOS
```bash
cd desktop && npm run tauri build
# Output: desktop/src-tauri/target/release/bundle/dmg/
```

---

## 📱 Android App

```bash
cd android
flutter pub get
flutter build apk --release --obfuscate --split-debug-info=build/debug-info
# APK: android/build/app/outputs/flutter-apk/app-release.apk
```

---

## 📊 Admin Dashboard

1. Navigate to `https://YOUR_SERVER_IP/admin`
2. Login with admin credentials
3. Monitor live sessions, IP logs, force logout users, block URLs remotely

---

## 🐳 Docker Deployment

```bash
cd docker
# Edit docker-compose.yml: replace YOUR_SERVER_IP and credentials
docker-compose up -d
```

Services started:
- `backend` — Node.js API on port 3000
- `postgres` — PostgreSQL DB on port 5432
- `nginx` — Reverse proxy on port 80/443

---

## 🔁 CI/CD

GitHub Actions runs on every push to `main`:
1. Lint backend code
2. Run backend unit tests
3. Build Tauri desktop app
4. Build Flutter APK (Android)
5. Build & push Docker images

---

## 🔐 Security Model

| Threat | Mitigation |
|--------|-----------|
| Traffic leakage | WireGuard kill-switch (PostDown rules) |
| VPN bypass | Backend VPN-IP middleware blocks non-VPN requests |
| Rooted device | Root detection kills app (Android) |
| Debugging attempt | Anti-debug detection + app hash verification |
| Screenshot leak | Android FLAG_SECURE on all windows |
| Replay attacks | JWT with short expiry + device binding |
| Anomalous behavior | AI anomaly detector flags unusual patterns |
| Tampered binary | File hash check on startup |
| Unauthorized URLs | Server-side URL whitelist/blacklist |

---

## 📜 License

MIT © RemoteShield X

---

## ⚠️ Legal Notice

This platform is designed for **enterprise remote work environments**. Usage must comply with local privacy laws and employee consent regulations. The developers are not responsible for misuse.

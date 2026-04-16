## 🛡️ RemoteShield X Browser v1.1.0

Enterprise-Grade Secure Remote Work Browser — All Platforms

---

### 📥 Download for Your Platform

| Platform | File | Notes |
|----------|------|-------|
| 🪟 **Windows 10/11** | `RemoteShield.X_1.0.0_x64_en-US.msi` | Windows Installer (recommended) |
| 🪟 **Windows 10/11** | `RemoteShield.X_1.0.0_x64-setup.exe` | NSIS Installer (alternative) |
| 🐧 **Ubuntu/Debian** | `remoteshield-x_*_amd64.deb` | Built by CI |
| 🐧 **Arch Linux** | `remoteshield-x_*_amd64.AppImage` | Universal Linux (Arch/Fedora/etc) |
| 🍎 **macOS** | `RemoteShield.X_*_universal.dmg` | M1/M2/M3 + Intel — Universal binary |
| 🤖 **Android ARM64** | `app-arm64-v8a-release.apk` | Modern phones (2017+) |
| 🤖 **Android ARMv7** | `app-armeabi-v7a-release.apk` | Older phones |
| 🤖 **Android x86_64** | `app-x86_64-release.apk` | Emulators / tablets |

> Linux/macOS/Android binaries are built by GitHub Actions and attach here automatically.

---

### 📋 Installation Instructions

#### 🪟 Windows
1. Download the `.msi` file from Assets below
2. Double-click to install
3. Launch **RemoteShield X** from Start Menu
4. Enter your backend server URL on first launch

#### 🐧 Linux — Ubuntu/Debian/Mint
```bash
sudo dpkg -i remoteshield-x_*_amd64.deb
remoteshield-x
```

#### 🐧 Linux — Arch Linux / Manjaro
```bash
# Install WebKit2GTK dependency
sudo pacman -S webkit2gtk-4.1

# Make AppImage executable and run
chmod +x remoteshield-x_*.AppImage
./remoteshield-x_*.AppImage
```

#### 🐧 Linux — Fedora / openSUSE
```bash
# Install dependency
sudo dnf install webkit2gtk4.1  # Fedora
# Then run AppImage
chmod +x remoteshield-x_*.AppImage && ./remoteshield-x_*.AppImage
```

#### 🍎 macOS (M1/M2/M3 + Intel)
1. Download the `.dmg` file
2. Open it and drag **RemoteShield X** to Applications
3. First launch: right-click → **Open** (bypasses Gatekeeper)

#### 🤖 Android
1. Settings → **Install from unknown sources** → Enable
2. Download the right APK:
   - `arm64-v8a` → Most phones made after 2017
   - `armeabi-v7a` → Older devices
   - `x86_64` → Emulators / Chromebooks
3. Tap to install and open

---

### ⚙️ Backend Setup (Required for full VPN enforcement)
```bash
git clone https://github.com/manikantbindass/RdPBrowser.git
cd RdPBrowser/backend
cp .env.example .env
# Edit .env: set SERVER_PUBLIC_IP, JWT_SECRET, DB_PASS
cd ../docker && docker-compose up -d
```

### 🔒 Security Features
- All traffic forced through WireGuard VPN with static IP
- **Android**: Screenshot prevention (`FLAG_SECURE`), root detection, APK signature verification
- **Desktop**: SHA-256 binary integrity check, VPN kill-switch (browser locks if tunnel drops)
- JWT session enforcement + force-logout from admin panel
- URL blocklist/whitelist with admin dashboard

### 📦 Docker / Container Images
```bash
docker pull ghcr.io/manikantbindass/remoteshield-backend:latest
docker pull ghcr.io/manikantbindass/remoteshield-nginx:latest
```

### 📦 npm Package (Backend SDK)
```bash
npm install @manikantbindass/remoteshield-x-backend
```

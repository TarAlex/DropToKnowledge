# 📁 DropToKnowledge — Android TWA + PWA

> Your single inbox for everything shared from Android — links, notes, documents, images, audio — saved automatically to a local folder on your device.

## Features

- **Web Share Target** — appears in Android's share menu for any app
- **Accepts everything** — URLs, text/notes, PDF, DOCX, PPTX, images, audio, video
- **Offline-first** — Service Worker caches the app shell; shares are stored in IndexedDB even offline
- **Local folder sync** — File System Access API writes files directly to a folder you choose
- **Markdown metadata** — All items include a `.md` file with YAML frontmatter for tags, comments, and IDs
- **TWA wrapper** — Ships as a real Android APK via Bubblewrap; no browser chrome, no install prompt
- **Dark theme** — OLED-friendly, mobile-optimized UI

---

## Project structure

```
DropToKnowledge/
├── index.html                # PWA entry point
├── manifest.webmanifest      # Web App Manifest + share_target
├── sw.js                     # Service Worker (share handler + cache)
├── css/style.css
├── js/
│   ├── app.js                # Main controller
│   ├── db.js                 # IndexedDB helpers
│   └── storage-local.js      # File System Access API adapter
├── icons/                    # PWA icons
├── android-twa/
│   ├── twa-manifest.json     # Bubblewrap TWA config
│   └── .well-known/
│       └── assetlinks.json   # Digital Asset Links (upload to server)
├── generate_icons.py         # Generates all icon sizes
├── build.sh                  # Build & deploy helper script
├── firebase.json             # Firebase Hosting config
└── nginx.conf                # Nginx self-hosting snippet
```

---

## Quick Start (GitHub Pages)

The app is configured to run at `https://taralex.github.io/DropToKnowledge/`.

### 1. Commit and Push
```bash
git add .
git commit -m "Deploy to GitHub Pages"
git push origin master
```

### 2. Enable GitHub Pages
- Go to your repo > **Settings** > **Pages**.
- Set Build and deployment > Source to **Deploy from a branch**.
- Select `branch: master` and folder `/ (root)`.
- Click **Save**.

---

## Building the Android APK (TWA)

### Prerequisites

- Node.js 18+
- Java JDK 17+
- Android SDK (or Android Studio)

### Steps

```bash
# 1. Install Bubblewrap
npm install -g @bubblewrap/cli

# 2. Initialize the TWA project
./build.sh twa-init

# 3. Build debug APK
./build.sh twa-build

# 4. Install on device
adb install android-twa/app-debug.apk
```

### Release build (Google Play)

```bash
# 1. Build signed release AAB
./build.sh twa-release

# 2. Get SHA-256 fingerprint for assetlinks.json
./build.sh assetlinks
# → Update .well-known/assetlinks.json

# 3. Upload .aab to Google Play Console
```

> **Important**: Ensure `assetlinks.json` is live at `https://taralex.github.io/DropToKnowledge/.well-known/assetlinks.json` so the app opens without a browser toolbar.

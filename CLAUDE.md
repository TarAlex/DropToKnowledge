# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DropToKnowledge is an offline-first PWA that acts as a universal inbox for content shared from Android's share menu. It accepts URLs, text, documents, images, audio, and video — storing them in IndexedDB and optionally syncing to local folders or cloud storage. It can be wrapped as an Android APK via Trusted Web Activity (TWA/Bubblewrap).

Deployed to GitHub Pages at `https://taralex.github.io/DropToKnowledge/`.

## Development

**Zero-build vanilla JS project** — no bundler, no transpiler, no package.json. Edit files directly.

```bash
# Local HTTPS dev server (requires mkcert + npx)
./build.sh pwa-dev

# Build TWA debug APK
./build.sh twa-build
```

There is no test suite, linter, or formatter configured.

## Architecture

```
Android Share → Service Worker (sw.js) → IndexedDB → app.js → UI
                                                   ↘ storage-local.js (File System Access API)
                                                   ↘ storage-cloud.js (OneDrive/GDrive/Dropbox OAuth)
```

**Data flow:** User shares content → SW intercepts POST to `/share-handler` → parses multipart form data, classifies by type, generates UUIDs → saves entries to IndexedDB → notifies open clients via `postMessage` → `app.js` re-renders → user can sync to local folder or cloud.

**Entry schema:** `{ id, type, title, text, url, filename, mime, content (ArrayBuffer), originalName, createdAt, synced }`

**Type classification:** `url` (regex-detected), `note` (plain text), `images` (image/*), `voice` (audio/*), `docs` (video/*, PDFs, Office docs, everything else).

## File Structure

All files live at the root level (single deployment target for GitHub Pages):

```
index.html              — Main HTML (simplified settings, local storage only)
sw.js                   — Service Worker (share handler, caching, IDB helpers)
manifest.webmanifest    — PWA manifest (relative paths, ./icons/*)
css/style.css           — Dark theme design system
js/app.js               — Main controller (state, settings, sync, modals)
js/db.js                — IndexedDB abstraction (entries + settings)
js/ui.js                — DOM rendering helpers (toast, cards, detail view)
js/storage-local.js     — File System Access API adapter
js/storage-cloud.js     — Cloud storage adapters (OneDrive, GDrive, Dropbox)
icons/                  — PWA icons (72–512px PNGs)
android-twa/            — Bubblewrap TWA config + assetlinks.json
build.sh                — Dev server + TWA build commands
```

## Key Conventions

- **ES Modules** — all JS uses `import`/`export`, loaded via `<script type="module">` in index.html. No dynamic imports.
- **DOM shortcuts** — `$()` = `getElementById`, `$$()` = `querySelectorAll`.
- **SW has duplicated IDB helpers** — Service Workers cannot import ES modules, so `sw.js` contains its own IndexedDB functions (separate from `db.js`).
- **Manual SW versioning** — bump the `APP_VERSION` constant in `sw.js` when deploying changes to force cache refresh.
- **XSS prevention** — use `escapeHtml()` from `ui.js` when rendering user content.
- **Dark theme only** — OLED-friendly CSS with custom properties. No light mode.
- **Mobile-first responsive** — breakpoints at 540px (modals) and 680px (sidebar). CSS respects `env(safe-area-inset-*)` for TWA safe areas.
- **Null guards in app.js** — the simplified `index.html` omits some settings elements (cloud buttons, organize-by-type, date-prefix, clear-inbox). `app.js` uses optional chaining (`?.addEventListener`) for these missing elements.

## Placeholders

These must be replaced before production use:
- Cloud OAuth client IDs in `js/storage-cloud.js` (`YOUR_*_CLIENT_ID`)
- Cloud OAuth redirect URIs in `js/storage-cloud.js` (`YOUR_DOMAIN`)
- SHA-256 fingerprint in `android-twa/.well-known/assetlinks.json`

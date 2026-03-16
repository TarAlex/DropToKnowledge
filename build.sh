#!/usr/bin/env bash
# =============================================================================
# build.sh — 1folder build & deploy helper
# Usage:
#   ./build.sh pwa-dev     Start local PWA dev server (HTTPS via mkcert)
#   ./build.sh pwa-build   Validate PWA files and create zip
#   ./build.sh twa-init    Initialize Bubblewrap TWA project from manifest
#   ./build.sh twa-build   Build debug APK with Bubblewrap
#   ./build.sh twa-release Build signed release AAB
#   ./build.sh deploy      Deploy PWA to Firebase Hosting (requires firebase-tools)
#   ./build.sh assetlinks  Print keystore fingerprint for assetlinks.json
# =============================================================================

set -euo pipefail

DOMAIN="${DOMAIN:-YOUR_DOMAIN}"
PACKAGE="${PACKAGE:-com.onefolder.app}"
KEYSTORE="${KEYSTORE:-./android-twa/android.keystore}"
KEY_ALIAS="${KEY_ALIAS:-1folder}"

command_exists() { command -v "$1" &>/dev/null; }
die()            { echo "❌  $*" >&2; exit 1; }
info()           { echo "ℹ️   $*"; }
ok()             { echo "✅  $*"; }

# ─── PWA dev server ──────────────────────────────────────────────────────────
pwa_dev() {
  info "Starting PWA dev server..."
  if command_exists mkcert; then
    mkcert -install 2>/dev/null || true
    mkcert localhost 2>/dev/null || true
    if command_exists npx; then
      npx serve public --ssl-cert ./localhost.pem --ssl-key ./localhost-key.pem -p 3000
    else
      die "npx not found. Install Node.js first."
    fi
  else
    info "mkcert not found — serving over HTTP (share target won't work on HTTP)"
    if command_exists python3; then
      cd public && python3 -m http.server 3000
    else
      die "Install either mkcert+npx or python3"
    fi
  fi
}

# ─── PWA build / validate ─────────────────────────────────────────────────────
pwa_build() {
  info "Validating PWA..."
  [[ -f "public/index.html" ]]              || die "Missing public/index.html"
  [[ -f "public/manifest.webmanifest" ]]    || die "Missing manifest.webmanifest"
  [[ -f "public/sw.js" ]]                   || die "Missing sw.js"
  [[ -f "public/icons/icon-192.png" ]]      || die "Missing icon-192.png — run: python3 generate_icons.py"
  [[ -f "public/icons/icon-512.png" ]]      || die "Missing icon-512.png"

  # Check domain is set
  if grep -q "YOUR_DOMAIN" public/manifest.webmanifest; then
    die "Replace YOUR_DOMAIN in manifest.webmanifest before building"
  fi

  info "Creating PWA zip..."
  rm -f 1folder-pwa.zip
  zip -r 1folder-pwa.zip public/ -x "*.DS_Store" -x "__MACOSX/*"
  ok "PWA build complete → 1folder-pwa.zip"
}

# ─── TWA init (Bubblewrap) ────────────────────────────────────────────────────
twa_init() {
  command_exists bubblewrap || die "Install Bubblewrap: npm install -g @bubblewrap/cli"

  info "Initializing TWA project from https://${DOMAIN}/manifest.webmanifest"

  mkdir -p android-twa && cd android-twa

  bubblewrap init \
    --manifest="https://${DOMAIN}/manifest.webmanifest" \
    --directory="." 2>&1 || true

  ok "TWA project initialized in android-twa/"
  info "Next: edit android-twa/twa-manifest.json, then run: ./build.sh twa-build"
}

# ─── TWA debug build ──────────────────────────────────────────────────────────
twa_build() {
  command_exists bubblewrap || die "Install Bubblewrap: npm install -g @bubblewrap/cli"

  info "Building debug APK..."
  cd android-twa
  bubblewrap build
  ok "Debug APK created in android-twa/app-debug.apk"
  info "To install: adb install app-debug.apk"
}

# ─── TWA release build ────────────────────────────────────────────────────────
twa_release() {
  command_exists bubblewrap || die "Install Bubblewrap: npm install -g @bubblewrap/cli"

  # Create keystore if it doesn't exist
  if [[ ! -f "$KEYSTORE" ]]; then
    info "Generating release keystore..."
    keytool -genkeypair \
      -keystore "$KEYSTORE" \
      -alias "$KEY_ALIAS" \
      -keyalg RSA \
      -keysize 2048 \
      -validity 9125 \
      -storepass "$(read -rsp 'Keystore password: ' p; echo "$p")" \
      -dname "CN=${PACKAGE}, OU=Android, O=1folder, L=Unknown, S=Unknown, C=US"
    ok "Keystore created at $KEYSTORE"
  fi

  info "Building release AAB..."
  cd android-twa
  bubblewrap build --skipPwaValidation
  ok "Release AAB ready — upload to Google Play Console"
}

# ─── Print SHA-256 fingerprint for assetlinks.json ────────────────────────────
assetlinks() {
  [[ -f "$KEYSTORE" ]] || die "Keystore not found at $KEYSTORE. Run ./build.sh twa-release first."

  info "SHA-256 fingerprint for android-twa/.well-known/assetlinks.json:"
  keytool -list -v \
    -keystore "$KEYSTORE" \
    -alias "$KEY_ALIAS" \
    2>/dev/null | grep "SHA256:" | awk '{print $2}'

  info "Copy this into android-twa/.well-known/assetlinks.json"
  info "Then upload to https://${DOMAIN}/.well-known/assetlinks.json"
}

# ─── Deploy to Firebase Hosting ───────────────────────────────────────────────
deploy() {
  command_exists firebase || die "Install Firebase CLI: npm install -g firebase-tools"

  info "Deploying PWA to Firebase Hosting..."
  firebase deploy --only hosting
  ok "Deployed! Make sure .well-known/assetlinks.json is accessible."
}

# ─── Dispatch ─────────────────────────────────────────────────────────────────
case "${1:-help}" in
  pwa-dev)     pwa_dev ;;
  pwa-build)   pwa_build ;;
  twa-init)    twa_init ;;
  twa-build)   twa_build ;;
  twa-release) twa_release ;;
  assetlinks)  assetlinks ;;
  deploy)      deploy ;;
  *)
    echo "1folder build script"
    echo ""
    echo "Usage: ./build.sh <command>"
    echo ""
    echo "Commands:"
    echo "  pwa-dev      Start HTTPS dev server (requires mkcert)"
    echo "  pwa-build    Validate & zip PWA for deployment"
    echo "  twa-init     Initialize Bubblewrap TWA project"
    echo "  twa-build    Build debug APK"
    echo "  twa-release  Build signed release AAB"
    echo "  assetlinks   Print keystore SHA-256 for assetlinks.json"
    echo "  deploy       Deploy to Firebase Hosting"
    ;;
esac

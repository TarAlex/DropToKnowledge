#!/usr/bin/env bash
# =============================================================================
# build.sh — DropToKnowledge build helper
# Usage:
#   ./build.sh pwa-dev     Start local PWA dev server (HTTPS via mkcert)
#   ./build.sh twa-init    Initialize Bubblewrap TWA project from manifest
#   ./build.sh twa-build   Build debug APK with Bubblewrap
#   ./build.sh twa-release Build signed release AAB
#   ./build.sh assetlinks  Print keystore fingerprint for assetlinks.json
# =============================================================================

set -euo pipefail

DOMAIN="${DOMAIN:-taralex.github.io}"
PACKAGE="${PACKAGE:-com.droptoknowledge.app}"
KEYSTORE="${KEYSTORE:-./android-twa/android.keystore}"
KEY_ALIAS="${KEY_ALIAS:-droptoknowledge}"

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
      npx serve . --ssl-cert ./localhost.pem --ssl-key ./localhost-key.pem -p 3000
    else
      die "npx not found. Install Node.js first."
    fi
  else
    info "mkcert not found — serving over HTTP (share target won't work on HTTP)"
    if command_exists python3; then
      python3 -m http.server 3000
    else
      die "Install either mkcert+npx or python3"
    fi
  fi
}

# ─── TWA init (Bubblewrap) ────────────────────────────────────────────────────
twa_init() {
  command_exists bubblewrap || die "Install Bubblewrap: npm install -g @bubblewrap/cli"

  info "Initializing TWA project from https://${DOMAIN}/DropToKnowledge/manifest.webmanifest"

  mkdir -p android-twa && cd android-twa

  bubblewrap init \
    --manifest="https://${DOMAIN}/DropToKnowledge/manifest.webmanifest" \
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
      -dname "CN=${PACKAGE}, OU=Android, O=DropToKnowledge, L=Unknown, S=Unknown, C=US"
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
  info "Then upload to https://${DOMAIN}/DropToKnowledge/.well-known/assetlinks.json"
}

# ─── Dispatch ─────────────────────────────────────────────────────────────────
case "${1:-help}" in
  pwa-dev)     pwa_dev ;;
  twa-init)    twa_init ;;
  twa-build)   twa_build ;;
  twa-release) twa_release ;;
  assetlinks)  assetlinks ;;
  *)
    echo "DropToKnowledge build script"
    echo ""
    echo "Usage: ./build.sh <command>"
    echo ""
    echo "Commands:"
    echo "  pwa-dev      Start HTTPS dev server (requires mkcert)"
    echo "  twa-init     Initialize Bubblewrap TWA project"
    echo "  twa-build    Build debug APK"
    echo "  twa-release  Build signed release AAB"
    echo "  assetlinks   Print keystore SHA-256 for assetlinks.json"
    ;;
esac

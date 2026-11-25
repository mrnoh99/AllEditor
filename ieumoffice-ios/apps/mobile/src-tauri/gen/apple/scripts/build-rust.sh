#!/bin/sh
# AllEditor — "Build Rust Code" phase.
# Default: use the committed prebuilt Rust library (built by CI from this repo's sources) so the project runs
# from Xcode without Node/npm/Rust. It is stored gzip-compressed and split into < 100 MB parts for GitHub:
#   Prebuilt/$PLATFORM_NAME/libapp.a.gz.part-aa, -ab, …  → joined with cat | gunzip (built into macOS).
# AE_BUILD_RUST=1 (env or Xcode build setting), or no prebuilt parts: build from source with the Tauri CLI
# (needs Node >= 22, Rust + iOS targets, and `npm ci` + the web build in ieumoffice-ios/ — see README-IOS.md).
set -e
mkdir -p "$SRCROOT/assets"
DIR="$SRCROOT/Prebuilt/$PLATFORM_NAME"
if [ "${AE_BUILD_RUST:-0}" != "1" ] && ls "$DIR"/libapp.a.gz.part-* >/dev/null 2>&1; then
  CACHE="$SRCROOT/Externals/prebuilt-$PLATFORM_NAME.a"
  STAMP="$SRCROOT/Externals/prebuilt-$PLATFORM_NAME.sha"
  SUM=$(cat "$DIR"/libapp.a.gz.part-* | /usr/bin/shasum | cut -d' ' -f1)
  if [ ! -f "$CACHE" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$SUM" ]; then
    mkdir -p "$SRCROOT/Externals"
    cat "$DIR"/libapp.a.gz.part-* | /usr/bin/gunzip -c > "$CACHE.tmp"
    mv -f "$CACHE.tmp" "$CACHE"
    echo "$SUM" > "$STAMP"
  fi
  for arch in $ARCHS; do
    if [ "$arch" != "arm64" ]; then
      echo "error: the prebuilt Rust library is arm64 only (asked for $arch). Use an Apple-silicon Mac / arm64 simulator, or set AE_BUILD_RUST=1."
      exit 1
    fi
    mkdir -p "$SRCROOT/Externals/$arch/$CONFIGURATION"
    cp -f "$CACHE" "$SRCROOT/Externals/$arch/$CONFIGURATION/libapp.a"
  done
  echo "AllEditor: using prebuilt Rust library from $DIR"
  exit 0
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"
# --- from source (Tauri CLI) ---
npm run -- tauri ios xcode-script -v --platform "${PLATFORM_DISPLAY_NAME:?}" --sdk-root "${SDKROOT:?}" --framework-search-paths "${FRAMEWORK_SEARCH_PATHS:?}" --header-search-paths "${HEADER_SEARCH_PATHS:?}" --gcc-preprocessor-definitions "${GCC_PREPROCESSOR_DEFINITIONS:-}" --configuration "${CONFIGURATION:?}" ${FORCE_COLOR} ${ARCHS:?}

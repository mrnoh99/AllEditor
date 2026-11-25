#!/bin/sh
# AllEditor — "Build Rust Code" phase.
# Default: copy the committed prebuilt Rust library (Prebuilt/$PLATFORM_NAME/libapp.a, built by CI from
# this repo's sources) so the project runs from Xcode without Node/npm/Rust.
# AE_BUILD_RUST=1 (env or Xcode build setting), or a missing prebuilt file: build from source with the Tauri CLI
# (needs Node >= 22, Rust + iOS targets, and `npm ci` + the web build in ieumoffice-ios/ — see README-IOS.md).
set -e
PREBUILT="$SRCROOT/Prebuilt/$PLATFORM_NAME/libapp.a"
if [ "${AE_BUILD_RUST:-0}" != "1" ] && [ -f "$PREBUILT" ]; then
  for arch in $ARCHS; do
    if [ "$arch" != "arm64" ]; then
      echo "error: the prebuilt Rust library is arm64 only (asked for $arch). Use an Apple-silicon Mac / arm64 simulator, or set AE_BUILD_RUST=1."
      exit 1
    fi
    mkdir -p "$SRCROOT/Externals/$arch/$CONFIGURATION"
    cp -f "$PREBUILT" "$SRCROOT/Externals/$arch/$CONFIGURATION/libapp.a"
  done
  echo "AllEditor: using prebuilt Rust library $PREBUILT"
  exit 0
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"
npm run -- tauri ios xcode-script -v --platform "${PLATFORM_DISPLAY_NAME:?}" --sdk-root "${SDKROOT:?}" --framework-search-paths "${FRAMEWORK_SEARCH_PATHS:?}" --header-search-paths "${HEADER_SEARCH_PATHS:?}" --gcc-preprocessor-definitions "${GCC_PREPROCESSOR_DEFINITIONS:-}" --configuration "${CONFIGURATION:?}" ${FORCE_COLOR} ${ARCHS:?}

# 이음오피스 iOS 앱 (ieumoffice's own mobile app, copied as-is)

This folder is a **verbatim copy of the iOS/Android mobile app of 이음오피스 (IeumOffice)** by 박준일 (Jun-il Park):
`apps/mobile` (Tauri 2 Mobile, bundle id `com.ieumoffice.mobile`) from
https://github.com/pblsketch/ieumoffice @ `ad22c056a9d217f11079a4dc30df12ccf233f8d3` (Apache-2.0),
plus the workspace packages and vendored rhwp engine it needs. Nothing in the app code was changed.
IeumOffice itself is built on GenOffice (Genspark AI / Mainfunc, Inc., Apache-2.0) — see `NOTICE`.
Scope of the app: HWP/HWPX and Markdown (`.md`/`.txt`) documents, one document at a time, AI helper, 22 languages.

(The Capacitor app in the repository root is a separate project: the full desktop suite running inside a WebView.)

## Build on a Mac (needs Xcode, Node ≥ 22, Rust)
```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
cd ieumoffice-ios
npm ci --ignore-scripts
npm run studio -w @genoffice/hwp          # builds the offline rhwp-studio HWP editor
npm run build -w @genoffice/mobile        # web bundle -> apps/mobile/dist
cd apps/mobile
npx @tauri-apps/cli@2 ios init --ci       # generates src-tauri/gen/apple (the Xcode project)
node scripts/apply-native-config.mjs      # injects the app's Info.plist / entitlements
npx @tauri-apps/cli@2 ios dev             # run on a simulator/device, or: ios build
open src-tauri/gen/apple/*.xcodeproj      # open in Xcode (set your signing team first)
```
The GitHub Action `.github/workflows/ieum-ios.yml` runs the same steps on `macos-latest` and uploads the generated
Xcode project as an artifact (`ieumoffice-ios-xcode-project`).

Release notes from the upstream `apps/mobile/AGENTS.md`: ChatGPT sign-in needs `IEUM_MOBILE_CHATGPT_CLIENT_ID`;
API keys live only in the Rust sealed store; HWP files get a backup before the first overwrite.

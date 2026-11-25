# 이음오피스 iOS 앱 (ieumoffice's own mobile app, copied as-is)

This folder is a **verbatim copy of the iOS/Android mobile app of 이음오피스 (IeumOffice)** by 박준일 (Jun-il Park):
`apps/mobile` (Tauri 2 Mobile, bundle id `com.ieumoffice.mobile`) from
https://github.com/pblsketch/ieumoffice @ `ad22c056a9d217f11079a4dc30df12ccf233f8d3` (Apache-2.0),
plus the workspace packages and vendored rhwp engine it needs. Nothing in the app code was changed.
IeumOffice itself is built on GenOffice (Genspark AI / Mainfunc, Inc., Apache-2.0) — see `NOTICE`.
Scope of the app: HWP/HWPX and Markdown (`.md`/`.txt`) documents, one document at a time, AI helper, 22 languages.


**AllEditor changes** (Apache-2.0 §4(b)): `src-tauri/tauri.conf.json` product name `AllEditor`, bundle id
`com.mrnoh99.alleditor`; `src-tauri/.gitignore` tracks `gen/apple`; new `scripts/ae-xcode-setup.mjs` (iPhone + iPad,
prebuilt Rust library); CI workflow `.github/workflows/ieum-ios.yml`.

## Open in Xcode (nothing to install)
```bash
open ieumoffice-ios/apps/mobile/src-tauri/gen/apple/*.xcodeproj
```
Pick your Team under *Signing & Capabilities* (bundle id `com.mrnoh99.alleditor`), choose an iPad / iPhone or
simulator, press Run. Targets iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`, all iPad orientations, multitasking).
The Rust app library with the web UI embedded is committed gzip-compressed and split into < 100 MB parts as `gen/apple/Prebuilt/{iphoneos,iphonesimulator}/libapp.a.gz.part-*`
(built by CI from this folder's sources), so the "Build Rust Code" phase just joins and unpacks it (`cat | gunzip`, built into macOS) — no Node / npm / Rust needed.
arm64 only (Apple-silicon Mac for the simulator). CI regenerates the library on every push to `main` that touches
`ieumoffice-ios/**` and commits it back. To build Rust from source in Xcode instead, set `AE_BUILD_RUST=1` (needs the
steps below).

## Build from source on a Mac (needs Xcode, Node ≥ 22, Rust)
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

## AllEditor: Word / PowerPoint / Excel / PDF inside this app (hybrid)
The home screen has an **오피스 문서** section (new Word / PowerPoint / Excel, open any office file). It opens the
AllEditor office suite — the GenOffice Docs / Slides / Sheets / PDF web apps with PDF tools, Pages·Keynote·Numbers
import, PDF export and printing (Settings › Printers: IPP 631 / raw 9100 / iOS print dialog) — in a full-screen layer
that stays alive while you are back on the 이음오피스 home (‹ 이음 button).
- Web suite: repository folder `office/` (built by `npm run office:sync` at the repo root),
  copied into the app as a folder reference `office` (added by `scripts/ae-xcode-setup.mjs`).
- Served by Rust on `office://localhost/…` (`src-tauri/src/office.rs`); native calls `POST office://localhost/__ae/<plugin>/<method>`:
  files (Documents, visible in Files › AllEditor), and `AEPdf` / `AEPrint` → Swift `AllEditorOfficePlugin`
  (`src-tauri/plugins/tauri-plugin-ieum-mobile/ios/Sources/AllEditorOfficePlugin.swift`).
- Desktop check without a device: `node scripts/dev/mock-office.js <dir>` + `scripts/dev/t-office-native.js`,
  `scripts/dev/t-tauri-office.js` (Playwright).
- **Open in AllEditor** (Files, Mail, Safari, …): Info.plist document types for docx/dotx/doc/odt, xlsx/xlsm/xls/ods/csv,
  pptx/ppt/odp, pdf, Pages/Numbers/Keynote (+ existing hwp/hwpx/md). iOS delivers the URL as `RunEvent::Opened`
  (`src-tauri/src/office.rs` `handle_opened`): hwp/hwpx/md → 이음오피스 editor (queued via `IeumFilePlugin.enqueueOpenUrl`,
  event `ae-open-intent`); office files → read by `AllEditorOfficePlugin.readIncomingUrl`, imported into the office suite
  as a copy in Documents (iWork → editable docx/pptx/xlsx copy), event `ae-office-intent` + command `ae_take_office_intents`.
  The document types live in the committed `gen/apple/.../Info.plist` (re-add them if the Xcode project is regenerated).
- Languages: Korean (default) and English only.
- iPad: landscape only, full screen (no Split View / Slide Over), status bar hidden (`ae-xcode-setup.mjs` + Info.plist).
- Office apps: an "AI ‹ / ›" handle on the AI panel edge folds / unfolds it; the choice is remembered (`shim/runtime/ai-toggle.ts`).
- "Pages로 보내기 / Keynote로 보내기 / Numbers로 보내기" (office tab bar): the tab's saved docx / pptx / xlsx goes to the
  iOS share sheet (`AEShare.share` → `IeumFilePlugin.shareFileBytes`); Pages / Keynote / Numbers open it and can keep it
  in Apple format. iWork files themselves are imported as editable copies (their format is closed; no write-back).
- Credit (all app screens, every language): "AllEditor (iOS / iPadOS) — Developed by JaiSung NOH MD, 2026. This app is
  built on the open source of 이음오피스 (IeumOffice) by 박준일 (Jun-il Park), which is itself based on GenOffice by
  Genspark AI / Mainfunc, Inc. (Apache License 2.0)"
- Version / build: version in `src-tauri/tauri.conf.json` (1.0.0); build number = commits on `main`, set by CI
  (`AE_BUILD_NUMBER` → Info.plist CFBundleVersion via `ae-xcode-setup.mjs`, and baked into the Rust library).
  Shown on the home ("버전 1.0.0 (빌드 N)") and in the office Settings › About. Raise the version in tauri.conf.json.
- 한글 is the fifth office app (이음오피스's desktop HWP app, `apps/hwp`, built into `office/hwp` with the rhwp-studio
  built in ieumoffice-ios — same pin + AllEditor's iOS input patches): 한글 files open as office tabs with 한글's full
  menus, the AI 도우미 docked on the left like Word. The home's 새 한글 / 파일 열기 / 최근 문서 (Documents folder,
  `ae_list_documents`) and Open in route 한글 there too; files are kept in Documents like the other documents.
- Rename: tap the active tab's name (office home) — the file is renamed in Documents and the tab reopens it.


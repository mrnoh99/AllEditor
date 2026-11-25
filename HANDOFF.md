# HANDOFF — AllEditor (ieum office for iOS)

Written for an agent starting cold. Read this first, then `README.md`. The user writes Korean; **reply in Korean**,
short, results first, honest about what was and was not verified.

## 0. DECISION 2026-11-25 — the base is 이음오피스's own iOS app (supersedes §1, §3–§6 where they conflict)
The user decided: **AllEditor is built on `ieumoffice-ios/`** = 이음오피스's Tauri-2 mobile app (`apps/mobile` copied verbatim
from `pblsketch/ieumoffice @ ad22c05`, plus the workspace packages / vendored rhwp it needs). Make it work on iOS,
**especially iPad**, then add features there. Xcode: `open AllEditor.xcworkspace` → scheme **ieumoffice-mobile_iOS**
(or `ieumoffice-ios/apps/mobile/src-tauri/gen/apple/ieumoffice-mobile.xcodeproj`); bundle id `com.mrnoh99.alleditor`.
- State: Xcode project committed (`gen/apple`, iPhone+iPad, all iPad orientations, multitasking); the Rust library (web UI
  embedded) is prebuilt by CI `.github/workflows/ieum-ios.yml` and committed gzip-split under `gen/apple/Prebuilt/` so Xcode
  needs no Node/npm/Rust (wrapper `gen/apple/scripts/build-rust.sh`, setup script `apps/mobile/scripts/ae-xcode-setup.mjs`).
  CI builds simulator debug/release + device release with nothing installed. **Never run on a real Mac/iPad yet.**
- The UI is still upstream's mobile layout (phone-first, tablet layout ≥ 768 px). iPad layout work is next.
- Every source push to `ieumoffice-ios/**` on main makes CI rebuild and commit the library (~135 MB per change in history).
- The Capacitor app (`ios/`, scheme App, GenOffice-based, §3–§4) and the "rebase on ieumoffice" plan in §5 are the
  **earlier approach** — keep as reference, don't extend unless the user asks. Ideas/code (PDF export, printing, iWork
  import, multi-app) may be ported into the Tauri app later.
- Credit: 이음오피스 = 박준일 (pblsketch/ieumoffice), based on GenOffice (Genspark AI / Mainfunc, Inc.); keep both.
  Root `NOTICE` still needs fixing (it credits ieum to Mainfunc and lacks ieumoffice's 3rd-party notices).

## 1. Goal
An iOS/iPadOS app that runs the open-source office suite **이음오피스 (IeumOffice)** — which is itself built on
**GenOffice** — "the same way" as the Mac/desktop app: Docs, Slides, Sheets, PDF (+PDF tools), HWP, local file open,
multi-tab home, settings, printing, PDF export. The user must be able to open it **directly in Xcode on a Mac**
(`open ios/App/App.xcworkspace`, no npm / pod install). iPad keeps the Mac UI, iPhone gets a phone layout.
Korean is the default UI language. Apple Pages/Keynote/Numbers files must open too.

Repo: `mrnoh99/AllEditor`. **The user wants everything pushed to `main`** (explicitly said so); the working branch
given by the harness is `claude/loving-volta-s4grp5` — push to both (`git push origin claude/loving-volta-s4grp5:main`).
Never create a PR unless asked. Commit trailers: see the harness' attribution reminder.

## 2. Credit text (user-mandated, keep small text, Korean first)
Home footer + Settings › About + README + NOTICE. Facts the user gave:
- 이음오피스 maker = **박준일 (Jun-il Park)**, GitHub `pblsketch/ieumoffice` (Apache-2.0).
- 이음오피스 is itself derived from **GenOffice** (`genspark-ai/genoffice`, Genspark AI / Mainfunc, Inc., Apache-2.0).
  Apache-2.0 requires keeping that attribution — never remove it.
- This iOS app: "Developed by JaiSung NOH MD 2026".
Current text (home.ts `credit()`), **needs updating after the rebase** (see §5) to say it is built on the open source of
이음오피스 by 박준일 (base code GenOffice). While the build is still GenOffice-based the text must NOT claim 이음오피스 code.

## 3. State of `main` (commit 4b87a85 and before) — all CI green on `macos-latest` (simulator build, no signing)
`main` is built from **genspark-ai/genoffice @ c57dc1a** (NOT yet 이음오피스). Everything below works in desktop
Chromium; **nothing has ever run on a real iPhone/iPad** (no Xcode in the sandbox).

| Area | What exists |
|---|---|
| Apps | Docs (+HWP/HWPX via convert-to-docx), Slides, Sheets, PDF |
| PDF tools | PDF → docx/pptx/xlsx on-device (PDFium wasm) — `shim/runtime/pdf-tools.ts` |
| Home / tabs / settings | `shim/home/home.ts` (+`i18n.ts` ko/en), tabs = one iframe per app, restored on launch; Settings: language (ko default), theme, doc theme, units, autosave, author, **AI provider/key/model**, **printers** |
| iWork import | `shim/iwork/convert.ts` (iwork-viewer parser → docx/pptx/xlsx) |
| PDF export | Docs/Slides/Sheets: snapshot DOM → native offscreen WKWebView + UIPrintPageRenderer (`AEPdfPlugin`) |
| Printing | apps' own print dialogs list printers from Settings (IP, IPP 631 / RAW 9100 / auto) → native `AEPrintPlugin`; else iOS print dialog (user's printer has NO AirPrint, so direct PDF over IPP/9100 is the main route) |
| Phone layout | `shim/runtime/phone.ts` (AI panel full-screen sheet, scrollable ribbon tabs, narrow rails); iPad = unchanged |
| Sheets file menu | floating ⋯ button (`start.ts addSheetsMenu`) because Sheets' File menu is a native menu on desktop |
| Native (Swift) | `ios/App/App/AppDelegate.swift`: `AEFilesPlugin` (Documents + private "support" dir), `AEPdfPlugin`, `AEPrintPlugin`, `AEViewController` (registers plugins, back-swipe) |

## 4. Architecture (the key idea — don't undo it)
The upstream apps are **Electron** apps. Instead of rewriting them, each app page loads `runtime.js`, a bundle of the
app's **real preload + real main-process code** with shims (`shim/runtime/`, bundler config `scripts/runtime-bundle.mjs`):
- `electron.ts`: in-page `ipcMain/ipcRenderer`, `dialog` (file input / auto Documents paths / confirm()), `app`, fake
  `BrowserWindow` for hidden export windows, `protocol.handle` + `fetch` override for custom schemes, print/printToPDF.
- `fs.ts`: **memfs**; `/Documents` ↔ iOS Documents folder (Files.app visible), `/userData` ↔ private Application Support,
  mirrored by `AEFilesPlugin` (browser preview: IndexedDB). Hydrated at page start, flushed debounced + on hide.
- Node built-ins → npm polyfills (`events util buffer path-browserify stream-browserify …`), own `zlib/os/crypto/url/module`
  shims; `child_process.spawn('xlsx-sidecar')` → wasm call. Unknown natives → inert stubs.
- **Sheets' Rust engine** (`apps/sheets/native/xlsx-engine`) is compiled to `wasm32-wasip1` by `native/xlsx-wasm`
  (wrapper crate; template `Cargo.toml.tmpl`) and driven by `shim/runtime/xlsx-host.ts` (WASI tree ↔ memfs sync).
- Handlers the Electron *shell* normally provides (settings, language, theme…) = `shim/runtime/shell-ipc.ts`
  (registered AFTER the apps so it wins). Settings live in `localStorage['alleditor.settings']`.
- `scripts/build-web.mjs`: clone upstream @ pinned SHA, `npm ci --ignore-scripts`, `vite build` each renderer, bundle
  runtime per app, patch CSP (`unsafe-eval`, `wasm-unsafe-eval`), build `www/`, then `npx cap copy ios` →
  `ios/App/App/public` (**committed**, plus committed `ios/App/Pods`, vendored Capacitor in `ios/vendor/`).
  CocoaPods works offline for local pods (`LANG=C.UTF-8 pod install --allow-root` after `gem install cocoapods`).
- No node-in-the-WebView, no service worker (custom scheme), no SharedArrayBuffer (stubbed in `boot.ts`).

Dev tests (Playwright, headless Chromium; seed files via `window.__seedFiles`, PDF/print via `window.__aePdfHook` /
`__aePrintHook`): `scripts/dev/t-*.js` (copied from /tmp; paths inside point at /tmp/claude-0 — adjust), fixtures in
`scripts/dev/fixtures/`. Serve with `cd www && python3 -m http.server 8765`. `NODE_PATH=$(npm root -g)`.

## 5. IN PROGRESS: rebase the build on 이음오피스 (user chose "option 2")
The user decided to rebuild on **`pblsketch/ieumoffice`** (pinned `ad22c056a9d217f11079a4dc30df12ccf233f8d3`, Apache-2.0).
Done so far (uncommitted work is on branch `claude/loving-volta-s4grp5` only — `main` is intentionally still the working
GenOffice build): `scripts/build-web.mjs` edited to
`REPO=pblsketch/ieumoffice`, new pinned SHA, 11-app default list (`docs slides sheets pdf hwp markdown html mindmap diagram epub whiteboard`),
generic `RUNTIMES` table (each app: `createXView(open)` + `registerAiIpc/registerProjectIpc` from docs-main), per-app
try/catch writing `www/apps.json`, `hwp` pre-step `npm run studio -w @genoffice/hwp`. **This script has never completed a
run against ieumoffice — the first build was interrupted by the user.**

Findings about ieumoffice (checked in a clone at /home/user/pblsketch/ieumoffice, `npm ci --ignore-scripts` ok, 37 s):
- Apps: diagram, docs, epub, html, hwp, markdown, mindmap, **mobile**, pdf, sheets, shell, slides, whiteboard; packages
  add `hwp5-wasm`, `docx2hwp`, `drawio-model`, `epub-engine`, `xmind-engine`, `whiteboard-engine`, `print-layout`,
  `mobile-bridge`, `google-drive`, `odt-engine`, `pdf-structure`, `doc-rules`; `vendor/drawio`, `vendor/rhwp-core`.
- **`apps/mobile`** = an existing Tauri-2 mobile shell (HWP + Markdown only, single document, AI, 22 languages, Rust
  backend). It is a different approach (not the full suite); worth reading (`apps/mobile/AGENTS.md`) for HWP-on-mobile
  ideas (Canvas2D-only rhwp, `hwp5-wasm`), but the plan is still our Electron-runtime approach for full desktop parity.
- Same main-process patterns as GenOffice: `createDocsView/createSlidesView/createSheetsView/createPdfView/createHwpView/
  createMarkdownView/createHtmlView/createMindmapView/createDiagramView/createEpubView(openPath required)/createWhiteboardView`.
  Docs needs `registerDocsIpc()` before `createDocsView`. Slides' `registerAiIpc` is re-exported from slides-main.
- `apps/shell/src/main/index.ts` is ~11k lines now and registers many more shell-level IPC groups (result store, version
  timeline, quick switcher, generate-editor, drive AI, outbound, templates, split pane, diagnostics, free AI…). Missing ones
  show up as `[ipc] no handler for …` warnings in the console — implement the ones that block UX in `shell-ipc.ts`.
- `shell/src/main/pdf2docx-local.ts|pdf2pptx-local.ts|pdf2xlsx-local.ts` still exist (pdf-tools.ts imports them via
  `@upstream/apps/shell/src/main/…`). PDF convert UI moved to `pdf-convert-ui*.ts` (check channel names).
- HWP: `apps/hwp` hosts **rhwp-studio**; needs `npm run studio -w @genoffice/hwp` (scripts/build-studio.mjs, vendor/rhwp-core,
  wasm). Untested whether it builds in the sandbox (may need Rust/wasm-pack). If not, copy what the mobile app does.

Next steps for the rebase (in order):
1. `rm -f dist/xlsx.wasm; UPSTREAM_DIR=/home/user/pblsketch/ieumoffice APPS=docs,slides,sheets,pdf node scripts/build-web.mjs`
   (≈3–5 min; run it in the background and poll, the interactive run was killed once). Fix esbuild errors the way they
   were fixed before (see `scripts/runtime-bundle.mjs`: add stubs/aliases for new Node built-ins or natives, `?asset`/`?raw`).
2. Serve `www/`, run the dev tests per app, fix console errors; then add apps one by one (hwp, markdown, html, mindmap,
   diagram, epub, whiteboard). Per-app extras: custom protocol schemes (`registerPrivilegedSchemes`, drawio/epub asset
   schemes → `protocol.handle` already routed through `fetch` override; `<img>`/iframes can't use them → may need blob URLs).
3. Update `shim/home/home.ts` APP_BY_EXT + new-document buttons + tab colors for the new apps (hwp native editor replaces the
   "convert HWP to docx" flow; md/html/mm/xmind/drawio/epub/whiteboard); update `phone.ts` selectors if class names differ.
4. Update `shell-ipc.ts` for 이음오피스's settings channels (free AI via OpenRouter/Gemini, ChatGPT/Claude subscription login
   will NOT work on iOS — API key / free providers only; check `packages/ai-provider` provider ids, AI settings UI in Home).
5. Re-verify PDF export / print / iWork / printers flows on the new tree; rebuild wasm; `npx cap copy ios`; commit incl.
   `ios/App/App/public`; push `main`; check CI (see §7).
6. Update credit (§2), README, NOTICE (3rd-party notices from ieumoffice's NOTICE: rhwp MIT + HWP notice sentence
   "본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.", draw.io Apache-2.0, frontend-slides MIT,
   Lucide ISC, Roboto, Pretendard OFL…) — those obligations apply once their code ships.
   ieumoffice has no `ee/` dir; verify its LICENSE/NOTICE before bundling fonts/templates.

## 6. Open items independent of the rebase
- **Saving was never verified end-to-end on device** (native mirror `AEFilesPlugin`, Save/Save As behaviour). Highest-risk.
- AI features need settings + network; the AI panel inside apps uses `ai:*` IPC from docs-main (`registerAiIpc`).
- Printing: IPP/RAW 9100 path and `UIPrintInteractionController` untested on hardware; printers lacking direct-PDF support
  (host-based inkjets) can't work without a PS/PCL/raster conversion step (not built).
- PDF export HTML→PDF via offscreen WKWebView is untested natively (only Chromium stand-in).
- iOS has no system fonts: Slides CJK text measured heuristically; consider bundling Pretendard/Noto (ieumoffice ships OFL fonts).
- iPhone UX is a CSS layer only; real touch usability untested.
- Not implemented: "Open in AllEditor" from other apps / document types in Info.plist, share sheet, spellcheck, Markdown/HTML
  (until rebase), quick switcher, drive integration.

## 7. Sandbox / process facts
- Linux container, no Xcode. Chromium + Playwright preinstalled (`require('playwright')`). Rust + `rustup target add wasm32-wasip1`
  works (engine build ≈ 1.5 min). Outbound goes via an allow-list proxy: GitHub git reads work, npm works, cdn.cocoapods.org does NOT
  (so no external pods — we vendored Capacitor and wrote our own Swift plugins instead of `@capacitor/filesystem`).
- CI: `.github/workflows/ios.yml` builds `ios/App/App.xcworkspace` for the simulator on every push (≈2 min). Check with
  `mcp__github__actions_list` (list_workflow_runs, branch main). Past failure causes: Pods ignored by `.gitignore`.
  After every Swift edit, expect a possible compile error and read the failed job logs (`get_job_logs`).
- GitHub tools are scoped to `mrnoh99/AllEditor`; other repos are read via plain `git clone` (anonymous reads).
- `www/`, `dist/`, `.build/`, `.upstream/` are gitignored; the committed web assets are in `ios/App/App/public`.
- Keep commits small, run `npx cap copy ios` before committing web changes, never commit secrets.

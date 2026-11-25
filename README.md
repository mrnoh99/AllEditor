# AllEditor (iOS / iPadOS)

*Built on the open source of 이음오피스 (IeumOffice) by 박준일 (Jun-il Park) — [pblsketch/ieumoffice](https://github.com/pblsketch/ieumoffice), Apache-2.0 —
which is itself based on [GenOffice](https://github.com/genspark-ai/genoffice) by Genspark AI / Mainfunc, Inc. (Apache-2.0); extended for iOS / iPad.*
*Developed by JaiSung NOH MD 2026*

The app is 이음오피스's own iOS app (Tauri 2, `ieumoffice-ios/apps/mobile`) with the AllEditor office suite added;
details in [`ieumoffice-ios/README-IOS.md`](ieumoffice-ios/README-IOS.md), project notes in [`HANDOFF.md`](HANDOFF.md).

## Open in Xcode (nothing to install)

```bash
git clone https://github.com/mrnoh99/AllEditor && cd AllEditor
open AllEditor.xcworkspace          # scheme: ieumoffice-mobile_iOS
```
Pick your Team under *Signing & Capabilities* (bundle id `com.mrnoh99.alleditor`), choose the iPad or a simulator,
press Run. No npm, Node or Rust is needed: the office suite (`office/`) and the prebuilt Rust library are committed;
CI (`.github/workflows/xcode-open.yml`) builds from a fresh clone with nothing installed. The prebuilt library is
arm64 only → Apple-silicon Mac (or a real device).

## AllEditor (base app) — what it does
| Area | Status |
|---|---|
| 한글 HWP / HWPX, Markdown | 이음오피스's mobile editor (one document at a time) |
| Word / PowerPoint / Excel / PDF | 이음오피스 editors (engine `pblsketch/ieumoffice@ad22c05`, built by `scripts/build-web.mjs`) in a full-screen layer with tabs; Excel engine as WebAssembly |
| PDF tools, PDF export, printing | PDF → Word/Excel/PowerPoint on device; Export as PDF; iOS print dialog or direct IP printer (IPP / 9100, Settings › Printers) |
| Apple Pages / Keynote / Numbers | imported as editable docx / pptx / xlsx copies; "Pages/Keynote/Numbers로 보내기" hands the edited file back through the share sheet |
| Open in AllEditor | docx/xlsx/pptx/pdf/iWork → office suite; hwp/hwpx/md → 이음오피스 editor |
| AI | Settings › AI 연결: Gemini (free key), OpenAI, Claude API, OpenRouter, other key providers; foldable AI panel |
| iPad | landscape, full screen; files in Files › AllEditor (iCloud via the Files app) |
| Languages | 한국어 (default), English |

Verified in desktop Chromium with an `office://` stand-in (`scripts/dev/`) and by macOS CI builds; **not yet run on a device.**

## How the office suite works
The 이음오피스 editors are Electron apps. Instead of rewriting them, their **real preload and main-process
code is bundled into the page** (`shim/runtime/`): `electron` is replaced by an in-page IPC bus,
`fs` by an in-memory filesystem mirrored to the iOS Documents folder (Rust `office.rs` on `office://`),
Node built-ins by browser polyfills, and the `xlsx-sidecar` process by `native/xlsx-wasm` (the Rust engine
compiled to `wasm32-wasip1`). PDF rendering, printing, sharing and links go to the Swift `AllEditorOfficePlugin`.

## Rebuilding the web bundle (macOS/Linux, Node ≥ 22, Rust + `wasm32-wasip1` target)
```bash
npm install
npm run office:sync   # clones 이음오피스 @ pinned commit, builds renderers + runtimes + wasm -> office/
```
`UPSTREAM_DIR=/path/to/ieumoffice` reuses an existing checkout. The Rust library is rebuilt by CI
(`.github/workflows/ieum-ios.yml`) on every push to `main` that touches `ieumoffice-ios/`.

## Known limitations
- Not yet run on a device: everything native (office://, PDF rendering, printing, Open in, share sheet) was verified
  only by macOS CI builds and in desktop Chromium with a stand-in (`scripts/dev/mock-office.js`).
- Direct network printing needs a printer that accepts PDF (IPP or port 9100).
- iWork files are imported as copies (their format is closed); "Pages로 보내기" hands edits back to Apple's apps.
- Desktop AI subscriptions (Claude Code, Codex) cannot run on iPad: API keys only.
- Documents over 512 KB load when opened (memory); an editor's own "recent files" may not open them — use the office home.
- `ee/` (GenOffice Enterprise License) is not included.

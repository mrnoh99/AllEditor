# AllEditor (iOS / iPadOS)

*Built on the open source of 이음오피스 (IeumOffice) by 박준일 (Jun-il Park) — [pblsketch/ieumoffice](https://github.com/pblsketch/ieumoffice), Apache-2.0 —
which is itself based on [GenOffice](https://github.com/genspark-ai/genoffice) by Genspark AI / Mainfunc, Inc. (Apache-2.0); extended for iOS / iPad.*
*Developed by JaiSung NOH MD 2026*

**Base app: `ieumoffice-ios/`** — 이음오피스's own iOS app (Tauri 2, `apps/mobile`), Xcode scheme **ieumoffice-mobile_iOS**.
All new iOS / iPad work goes there; see [`ieumoffice-ios/README-IOS.md`](ieumoffice-ios/README-IOS.md).
The Capacitor app (`ios/`, scheme **App**, GenOffice-based, documented below) is the earlier approach, kept as reference.

## Open in Xcode (nothing to install)

```bash
git clone https://github.com/mrnoh99/AllEditor && cd AllEditor
open AllEditor.xcworkspace
```
`AllEditor.xcworkspace` (repository root) contains both iOS apps — choose the scheme at the top of Xcode:

| Scheme | App |
|---|---|
| **ieumoffice-mobile_iOS** (base) | **AllEditor**: 이음오피스 mobile app (HWP / Markdown) + office suite (Word / PowerPoint / Excel / PDF, iWork import, printing, AI) — see `ieumoffice-ios/README-IOS.md` |
| **App** (earlier, reference) | GenOffice suite (Docs / Slides / Sheets / PDF), Capacitor — same as `open ios/App/App.xcworkspace`; same bundle id, do not install both |

No npm, CocoaPods, Node or Rust is needed: the web bundle, `Pods/` and the prebuilt Rust library are committed.
CI (`.github/workflows/xcode-open.yml`) builds both schemes from a fresh clone with nothing installed.
The ieumoffice app's prebuilt library is arm64 only → Apple-silicon Mac (or a real device).
Pick your Team under *Signing & Capabilities* (bundle id `com.mrnoh99.alleditor`, change if taken),
choose an iPhone/iPad or simulator, press Run. The built web app is committed in
`ios/App/App/public` and CocoaPods' `Pods/` is committed, so no `npm install` / `pod install` is needed.

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

## Capacitor app (`ios/`, earlier approach) — what works
| Feature | How |
|---|---|
| **Docs** `.docx .dotx .doc .odt` and **HWP/HWPX** (converted to an editable `.docx` copy) | real upstream Docs app |
| **Slides** `.pptx` | real upstream Slides app |
| **Sheets** `.xlsx .xlsm .csv .tsv …` | real Sheets app; the Rust xlsx engine runs as WebAssembly |
| **PDF** view / annotate / edit text / forms / merge / compress | real PDF app |
| **PDF tools** PDF → Word / Excel / PowerPoint (on-device, PDFium wasm) | PDF ▸ “PDF 转换/Convert” menu |
| **Apple Pages / Keynote / Numbers** `.pages .key .numbers` | converted once to an editable `.docx` / `.pptx` / `.xlsx` copy (original untouched), then opened in Docs / Slides / Sheets. Text, tables, images, charts and notes are kept; Numbers formulas become their saved values; Pages layout becomes flowing text; animations are dropped |
| **PDF export** (Docs / Slides / Sheets) | the app's own “Export as PDF”; the page is snapshotted and paginated by an offscreen WKWebView with `@media print` rules (`AEPdfPlugin`), saved to Documents and opened in a PDF tab. Sheets: floating ⋯ file menu (open / save / save as / PDF / CSV) |
| **Printing** | the apps' own print dialogs list the printers added in **Settings › Printers** (IP address, IPP 631 / RAW 9100 / auto) and send the PDF straight over the home network, with copies and duplex; no printer chosen → the iOS print dialog (AirPrint). Needs a printer that accepts PDF directly; local-network permission is requested on first use |
| **Open local files** | launcher “Open local file…” (Files app, iCloud Drive, …); files are copied into the app's Documents folder, which is visible in *Files ▸ AllEditor* |

The app opens on a **Home** tab (open local file, new document/slides/sheet, file list). Every file opens in its own
**tab** (one editor per tab, restored on next launch); **⚙ Settings** has language (Korean default), theme,
document theme, units, autosave, author name and the **AI model** (provider, API key, model, base URL).
App settings/keys live in the app's private storage, documents in Documents (visible in Files).

## iPad vs iPhone
- **iPad** (shorter screen side ≥ 600 pt): the unchanged Mac UI.
- **iPhone**: same apps with a phone layer (`shim/runtime/phone.ts`): the AI panel starts closed and opens
  as a full-screen sheet, the ribbon tab row scrolls horizontally instead of wrapping, and the slide/PDF
  thumbnail rails are narrowed.

## How it works
The upstream apps are Electron apps. Instead of rewriting them, their **real preload and main-process
code is bundled into the page** (`shim/runtime/`): `electron` is replaced by an in-page IPC bus,
`fs` by an in-memory filesystem mirrored to the iOS Documents folder (native plugin `AEFilesPlugin` in
`ios/App/App/AppDelegate.swift`), Node built-ins by browser polyfills, and the `xlsx-sidecar` process by
`native/xlsx-wasm` (the upstream Rust engine compiled to `wasm32-wasip1`).

## Rebuilding the web bundle (macOS/Linux, Node ≥ 22, Rust + `wasm32-wasip1` target)
```bash
npm install
npm run ios:sync      # clones upstream @ pinned commit, builds renderers + runtimes + wasm, `cap copy`
```
`UPSTREAM_DIR=/path/to/genoffice` reuses an existing checkout.

## Known limitations
- Direct network printing (IPP/RAW) and the iOS print dialog are untested on hardware; only the routing to the configured printer was verified in Chromium.
- PDF export was verified only with Chromium standing in for the native renderer (`window.__aePdfHook`); the WKWebView renderer is untested.
- Verified in desktop Chromium only (this was built on Linux with no Xcode); first on-device run is yours.
- No system fonts on iOS: bundled fonts + web fonts only, CJK text in Slides uses heuristic metrics.
- AI features need a provider configured in settings and network access; printing, spellcheck,
  system share sheet, "Open in AllEditor" from other apps and the Markdown/HTML apps are not included.
- Documents folder files > 30 MB are not loaded into memory.
- `ee/` (GenOffice Enterprise License) is intentionally not included.

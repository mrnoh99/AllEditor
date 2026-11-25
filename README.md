# AllEditor (iOS)

*이음 오피스 (ieum office) — built on the open-source GenOffice (Genspark AI / Mainfunc, Apache-2.0), extended for iOS.*
*Developed by JaiSung NOH MD 2026*

iOS build of the open-source [GenOffice](https://github.com/genspark-ai/genoffice) suite
(Apache-2.0; pinned commit in `scripts/build-web.mjs`).

## Open in Xcode (nothing to install)

```bash
open ios/App/App.xcworkspace
```
Pick your Team under *Signing & Capabilities* (bundle id `com.mrnoh99.alleditor`, change if taken),
choose an iPhone/iPad or simulator, press Run. The built web app is committed in
`ios/App/App/public` and CocoaPods' `Pods/` is committed, so no `npm install` / `pod install` is needed.

## What works
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

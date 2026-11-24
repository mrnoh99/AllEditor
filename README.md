# AllEditor (iOS)

iOS build of the open-source [GenOffice](https://github.com/genspark-ai/genoffice) suite
(Apache-2.0, pinned commit in `scripts/build-web.mjs`). It runs the upstream web renderers
inside a Capacitor WKWebView and replaces the Electron preload bridge with
`shim/desktop-shim.ts`.

## Status
- **Docs (.docx)** boots and edits; open via the iOS Files picker, save writes to the app's
  Documents folder (visible in Files › AllEditor).
- Not yet wired: Sheets, Slides, PDF, Markdown, HTML (build with `APPS=docs,sheets,...`, but
  their file APIs are no-ops until implemented in the shim), AI provider calls, the
  Electron shell/home screen, printing, spellcheck.
- `ee/` (Enterprise License) is intentionally **not** included.
- Not yet compiled on a Mac — `.github/workflows/ios.yml` runs the first simulator build.

## Build (macOS + Xcode)
```bash
npm install
npm run ios:sync     # clones/builds upstream renderers into www/, cap sync
npm run ios:open     # opens Xcode; set your signing team, run
```

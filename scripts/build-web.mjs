// Builds the upstream office renderers (이음오피스 / IeumOffice, itself based on GenOffice) as plain web apps and
// assembles www/ (the office suite of the iOS apps).
//   UPSTREAM_DIR=/path/to/ieumoffice node scripts/build-web.mjs   (skip cloning)
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { bundleRuntime } from './runtime-bundle.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'https://github.com/pblsketch/ieumoffice' // 이음오피스 (박준일), Apache-2.0 — same pin as ieumoffice-ios/
const PINNED = 'ad22c056a9d217f11079a4dc30df12ccf233f8d3'
const upstream = process.env.UPSTREAM_DIR ?? join(root, '.upstream-ieum')
const APPS = (process.env.APPS ?? 'docs,slides,sheets,pdf,hwp').split(',') // renderer apps to bundle
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

if (!existsSync(join(upstream, 'package.json'))) {
  run('git', ['clone', REPO, upstream], root)
  run('git', ['checkout', PINNED], upstream)
}
if (!existsSync(join(upstream, 'node_modules'))) {
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], upstream)
}

/**
 * AllEditor source edits on the 이음오피스 checkout, applied to pristine files (git checkout first, so a re-run
 * never stacks them). Every edit must apply.
 *  - font pickers: the iPad's own fonts and the bundled free Korean fonts (fonts/, shim/runtime/fonts.ts)
 *  - template fonts: loaded from the bundled folder instead of the desktop shell's genoffice-docx-media:// scheme
 */
const SOURCE_EDITS = {
  'packages/ui/src/font-list.ts': [
    // the fonts neither the iPad nor the bundle has go to the end of every list (shim/runtime/fonts.ts MISSING)
    ['export const BUILTIN_FONT_FAMILIES: readonly string[] = [', 'const BUILTIN_FONT_FAMILIES_UPSTREAM: readonly string[] = ['],
    ['export function fontFamiliesFor(lang: Lang): readonly string[] {',
     "const AE_IPAD_MISSING = new Set(" + JSON.stringify(['Impact', 'Garamond', '等线', '等线 Light', '宋体', '黑体', '微软雅黑', '楷体', '仿宋', '仿宋_GB2312', '楷体_GB2312', '方正小标宋简体', 'Noto Sans SC', 'Noto Serif SC', 'Yu Gothic', 'Yu Mincho', 'Meiryo', 'MS Gothic', 'MS Mincho', 'Noto Sans JP', 'Noto Serif JP', 'Microsoft JhengHei', 'PMingLiU', 'Noto Sans TC', 'Noto Serif TC']) + ')\n' +
     'function aeIPadOrder(list: readonly string[]): readonly string[] {\n  return [...list.filter((f) => !AE_IPAD_MISSING.has(f)), ...list.filter((f) => AE_IPAD_MISSING.has(f))]\n}\n' +
     'export const BUILTIN_FONT_FAMILIES: readonly string[] = aeIPadOrder(BUILTIN_FONT_FAMILIES_UPSTREAM)\n' +
     'export function fontFamiliesFor(lang: Lang): readonly string[] {\n  return aeIPadOrder(fontFamiliesForUpstream(lang))\n}\n' +
     'function fontFamiliesForUpstream(lang: Lang): readonly string[] {'],
    ["  'Courier New',\n  'Impact',\n",
     "  'Courier New',\n  'Impact',\n  // iPad (iPadOS) fonts\n" +
     ['Helvetica Neue', 'Helvetica', 'Avenir Next', 'Avenir', 'Futura', 'Gill Sans', 'Optima', 'Palatino', 'Baskerville',
      'Didot', 'Hoefler Text', 'Charter', 'American Typewriter', 'Menlo', 'Courier', 'Noteworthy', 'Marker Felt',
      'Chalkboard SE', 'Snell Roundhand'].map((f) => `  '${f}',\n`).join('')],
  ],
  'packages/i18n/src/font-names.ts': [
    ["export const KOREAN_FAMILIES: readonly string[] = [\n",
     "export const KOREAN_FAMILIES: readonly string[] = [\n  // AllEditor: bundled free fonts first, then the iPad's own\n  'Nanum Gothic',\n  'Nanum Myeongjo',\n  'Nanum Gothic Coding',\n  'AppleMyungjo',\n"],
    ["  Pretendard: ['프리텐다드'],\n",
     "  Pretendard: ['프리텐다드'],\n  'Nanum Gothic': ['나눔고딕'],\n  'Nanum Myeongjo': ['나눔명조'],\n  'Nanum Gothic Coding': ['나눔고딕코딩'],\n  AppleMyungjo: ['애플명조'],\n"],
  ],
  // PowerPoint save: JSZip's Node stream does not exist in the browser ("nodestream is not supported by this
  // platform"); the package is built in one piece with the same options and written once — the same bytes
  'packages/pptx-engine/src/index.ts': [
    ["  const { createWriteStream } = await import('node:fs')\n  const { pipeline } = await import('node:stream/promises')\n  const source = buildZip(opened).generateNodeStream({",
     "  const { writeFileSync } = await import('node:fs')\n  const source = buildZip(opened).generateAsync({"],
    ["    await pipeline(source, createWriteStream(filePath))", "    writeFileSync(filePath, await source)"],
    ["    type: 'nodebuffer',\n    compression: 'DEFLATE',\n    compressionOptions: { level: 6 },\n    streamFiles: true,\n  })\n  try {",
     "    type: 'uint8array',\n    compression: 'DEFLATE',\n    compressionOptions: { level: 6 },\n    streamFiles: true,\n  })\n  try {"],
  ],
  // default font of a new Word document: serif fonts that Windows, macOS and iOS all know (user's choice) —
  // Latin Times New Roman (built into all three), Hangul 바탕/Batang (Windows, Office for Mac; on the iPad drawn
  // with AppleMyungjo, shim/runtime/fonts.ts DOCS_SERIF)
  'packages/docx-engine/src/blank.ts': [
    ['w:ascii="Calibri"', 'w:ascii="Times New Roman"'],
    ['w:hAnsi="Calibri"', 'w:hAnsi="Times New Roman"'],
  ],
  'apps/docs/src/renderer/file-actions.ts': [
    ['    eastAsiaFont: defaultEastAsiaFontFor(getLang()),\n    paperSize', "    eastAsiaFont: 'Batang', // AllEditor default (was defaultEastAsiaFontFor(getLang()))\n    paperSize"],
  ],
  // a "폭 맞춤" (fit to width) button beside the zoom controls, bottom right (the editor's own zoomFit('width'))
  'apps/docs/src/renderer/App.tsx': [
    ["                {Math.round(zoom)}%\n              </button>\n            </div>\n          </footer>",
     "                {Math.round(zoom)}%\n              </button>\n" +
     "              <button\n                className=\"zoom-btn ae-fit-width\"\n                data-tip={lang === 'ko' ? '폭 맞춤' : 'Fit to width'}\n                aria-label={lang === 'ko' ? '폭 맞춤' : 'Fit to width'}\n                disabled={!doc}\n                onClick={() => zoomFit('width')}\n              >\n" +
     "                <svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"1.9\" strokeLinecap=\"round\" strokeLinejoin=\"round\"><path d=\"M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3\"/></svg>\n" +
     "              </button>\n            </div>\n          </footer>"],
  ],
  // the same "폭 맞춤" button in PDF (its own chooseFit('width')) and PowerPoint (fit the slide, zoomToFit)
  'apps/pdf/src/renderer/App.tsx': [
    ['              <span className="zoom-value">{Math.round(scale * 100)}%</span>\n            </div>\n          </footer>',
     '              <span className="zoom-value">{Math.round(scale * 100)}%</span>\n              <button className=\"zoom-btn ae-fit-width\" data-tip={lang === "ko" ? "폭 맞춤" : "Fit to width"} aria-label={lang === "ko" ? "폭 맞춤" : "Fit to width"} onClick={() => chooseFit("width")}><svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"1.9\" strokeLinecap=\"round\" strokeLinejoin=\"round\"><path d=\"M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3\"/></svg></button>\n            </div>\n          </footer>'],
    ['  applyEditOpsRef.current = applyEditOps\n', "  applyEditOpsRef.current = applyEditOps\n  // [AllEditor] eraser (shim/runtime/pdf-pencil.ts): delete the drawing annotation saved in the file (pen stroke,\n  // line / arrow, rectangle, ellipse, polygon, polyline) whose outline passes within a few pixels of a screen point —\n  // the same deleteSavedAnnot op as deleting a saved markup (undoable)\n  ;(window as any).__aeEraseSavedInk = async (clientX: number, clientY: number): Promise<boolean> => {\n    const pageEl = document.elementsFromPoint(clientX, clientY).find((n) => (n as HTMLElement).classList?.contains('pdf-page')) as HTMLElement | undefined\n    if (!pageEl || !doc) return false\n    const origIdx = Number(pageEl.dataset.page)\n    if (!Number.isFinite(origIdx)) return false\n    const box = pageEl.getBoundingClientRect()\n    const [px, py] = viewToPdf(pageGeom(origIdx), (clientX - box.left) / scale, (clientY - box.top) / scale)\n    const tol = 10 / scale\n    const pending = new Set(annotDeletesRef.current.map((d) => d.annot.objNum))\n    let annots: any[] = []\n    try { annots = (await (await doc.getPage(origIdx + 1)).getAnnotations()) as any[] } catch { return false }\n    const near = (pts: ArrayLike<number>) => {\n      for (let i = 0; i + 1 < pts.length; i += 2) {\n        const ax = pts[i]!, ay = pts[i + 1]!\n        const bx = i + 3 < pts.length ? pts[i + 2]! : ax, by = i + 3 < pts.length ? pts[i + 3]! : ay\n        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy\n        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0\n        if (Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= tol) return true\n      }\n      return false\n    }\n    const flat = (v: any): number[] => (!v ? [] : Array.isArray(v) && typeof v[0] === 'object' ? v.flatMap((q: any) => [q.x, q.y]) : Array.from(v as ArrayLike<number>))\n    const kinds: Record<string, string> = { Ink: 'ink', Line: 'line', Square: 'square', Circle: 'circle', Polygon: 'polygon', PolyLine: 'polyline' }\n    for (let i = annots.length - 1; i >= 0; i--) {\n      const a = annots[i]\n      const type = kinds[a?.subtype]\n      if (!type || !Array.isArray(a.rect)) continue\n      const objNum = parseInt(String(a.id), 10)\n      if (!Number.isFinite(objNum) || pending.has(objNum)) continue\n      const [x1, y1, x2, y2] = [Math.min(a.rect[0], a.rect[2]), Math.min(a.rect[1], a.rect[3]), Math.max(a.rect[0], a.rect[2]), Math.max(a.rect[1], a.rect[3])]\n      let lines: number[][] = []\n      if (type === 'ink') lines = (a.inkLists ?? []).map(flat)\n      else if (type === 'line') lines = [flat(a.lineCoordinates)]\n      else if (type === 'polygon') { const v = flat(a.vertices); lines = [v.length ? [...v, v[0]!, v[1]!] : []] }\n      else if (type === 'polyline') lines = [flat(a.vertices)]\n      else if (type === 'square') lines = [[x1, y1, x2, y1, x2, y2, x1, y2, x1, y1]]\n      else {\n        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2, ring: number[] = []\n        for (let k = 0; k <= 48; k++) ring.push(cx + rx * Math.cos((k / 48) * 2 * Math.PI), cy + ry * Math.sin((k / 48) * 2 * Math.PI))\n        lines = [ring]\n      }\n      if (!lines.some((l) => l.length >= 2 && near(l))) continue\n      applyEditOpsRef.current([{ op: 'deleteSavedAnnot', annot: { pageIndex: origIdx, objNum, type, rect: [a.rect[0], a.rect[1], a.rect[2], a.rect[3]] } } as Op])\n      showDeletedToast()\n      return true\n    }\n    return false\n  }\n"],
  ],
  'apps/slides/src/renderer/App.tsx': [
    ['              <ZoomControls zoom={zoom} onPreview={previewZoom} />\n            </div>',
     '              <ZoomControls zoom={zoom} onPreview={previewZoom} />\n              <button className=\"zoom-btn ae-fit-width\" data-tip={lang === "ko" ? "폭 맞춤" : "Fit to width"} aria-label={lang === "ko" ? "폭 맞춤" : "Fit to width"} onClick={zoomToFit}><svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"1.9\" strokeLinecap=\"round\" strokeLinejoin=\"round\"><path d=\"M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3\"/></svg></button>\n            </div>'],
  ],
  // PowerPoint's save button: usable whenever a deck is open (as in Word), not only while the deck is marked
  // dirty — with AutoSave on, or while a text box is being edited, it stayed greyed out
  'apps/slides/src/renderer/components/Ribbon.tsx': [
    ["          disabled={!dirty}\n          onClick={onSave}", "          disabled={!hasDoc}\n          onClick={onSave}"],
  ],
  // saved-annotation deletes know Ink (the eraser's pen strokes) besides markups, notes and polygons
  'apps/pdf/src/main/annot-delete.ts': [
    ['  polygon: 7, // FPDF_ANNOT_POLYGON\n', '  polygon: 7, // FPDF_ANNOT_POLYGON\n  ink: 15, line: 4, square: 5, circle: 6, polyline: 8, // FPDF_ANNOT_* (AllEditor eraser: drawings)\n'],
  ],
  'packages/ui/src/template-fonts.ts': [
    ['  return `${TEMPLATE_FONT_SCHEME}://${TEMPLATE_FONT_HOST}/${encodeURIComponent(file)}`',
     '  return `/hwp/studio/fonts/tpl/${encodeURIComponent(file)}` // AllEditor: bundled copy (office/hwp/studio/fonts/tpl)'],
  ],
}
for (const [file, edits] of Object.entries(SOURCE_EDITS)) {
  run('git', ['checkout', '--', file], upstream)
  const p = join(upstream, file)
  let code = readFileSync(p, 'utf8')
  for (const [from, to] of edits) {
    if (!code.includes(from)) throw new Error(`${file} changed upstream; cannot apply: ${from.slice(0, 60)}`)
    code = code.replace(from, to)
  }
  writeFileSync(p, code)
}

/**
 * A copy of the 이음오피스 xlsx engine with the WASI-only branches GenOffice later added upstream (its engine runs
 * in a browser too): no `std::env::temp_dir` (panics on WASI), worksheet indexing inline instead of on a thread.
 * Native builds of the same source behave exactly as before; every edit must apply.
 */
function wasiEngineCopy(crate) {
  const src = join(upstream, 'apps/sheets/native/xlsx-engine'), dst = join(crate, 'xlsx-engine')
  rmSync(dst, { recursive: true, force: true })
  cpSync(src, dst, { recursive: true, filter: (p) => !p.includes('/target') })
  const lib = join(dst, 'src/lib.rs')
  let code = readFileSync(lib, 'utf8')
  const edits = [
    ['let path = std::env::temp_dir().join(format!("genspark-ai-excel-{session_id}"));',
     'let path = wasi_safe_temp_dir().join(format!("genspark-ai-excel-{session_id}"));'],
    ['    fn ensure_parser(&mut self, sheet_index: usize) -> Result<(), SidecarError> {\n        let runtime = &mut self.runtimes[sheet_index];\n        if runtime.handle.is_some() {',
     '    fn ensure_parser(&mut self, sheet_index: usize) -> Result<(), SidecarError> {\n        let runtime = &mut self.runtimes[sheet_index];\n        // WASI: indexed inline once; complete (or failed) means done\n        let indexed_inline = cfg!(target_os = "wasi")\n            && runtime.state.0.lock().map(|i| i.complete || i.error.is_some()).unwrap_or(false);\n        if runtime.handle.is_some() || indexed_inline {'],
    ['        let handle = thread::Builder::new()\n            .name(format!("xlsx-index-{sheet_index}"))\n            .spawn(move || {',
     '        let index_job = move || {'],
    ['                    condition.notify_all();\n                }\n            })?;\n        runtime.handle = Some(handle);',
     '                    condition.notify_all();\n                }\n            };\n        if cfg!(target_os = "wasi") {\n            index_job(); // wasm32-wasip1 has no threads\n        } else {\n            runtime.handle = Some(\n                thread::Builder::new().name(format!("xlsx-index-{sheet_index}")).spawn(index_job)?,\n            );\n        }'],
  ]
  for (const [from, to] of edits) {
    if (!code.includes(from)) throw new Error('xlsx engine lib.rs changed upstream; cannot apply: ' + from.slice(0, 70))
    code = code.replace(from, to)
  }
  code += `
/// \`std::env::temp_dir\` panics on WASI: there the host maps a directory named in \`TMPDIR\` (\`/tmp\` when unset).
fn wasi_safe_temp_dir() -> PathBuf {
    if cfg!(target_os = "wasi") {
        std::env::var_os("TMPDIR").map_or_else(|| PathBuf::from("/tmp"), PathBuf::from)
    } else {
        std::env::temp_dir()
    }
}
`
  writeFileSync(lib, code)
  return dst
}

/** The sidecar's main.rs as a module of the wasm wrapper (native/xlsx-wasm/src/lib.rs); every edit must apply. */
function patchSidecarMain(src) {
  const edits = [
    // responses go to an in-memory buffer the wrapper drains after each request
    ['type SharedOutput = Arc<Mutex<BufWriter<io::Stdout>>>;', 'pub(crate) type SharedOutput = Arc<Mutex<Vec<u8>>>;'],
    ['fn write_response(', 'pub(crate) fn write_response('],
    // wasm32-wasip1 has no threads: run the recalc worker inline (its reply lands in the buffer)
    ['        let spawned = thread::Builder::new()\n            .name("xlsx-recalc".into())\n            .spawn(move || {',
     '        let spawned: Result<(), std::io::Error> = Ok((move || {'],
    ['                let _ = write_response(&output, &response);\n            });\n        match spawned {',
     '                let _ = write_response(&output, &response);\n            })());\n        match spawned {'],
    ['fn main() {', 'fn _stdio_main() {'],
    ['#[cfg(test)]\nfn handle_line(', 'pub(crate) fn handle_line('],
    ['struct RecalcWorker {', 'pub(crate) struct RecalcWorker {'],
    ['\nstruct Response {', '\npub(crate) struct Response {'],
    ['struct CancelledRequests(', 'pub(crate) struct CancelledRequests('],
    ['struct InFlightRequest(', 'pub(crate) struct InFlightRequest('],
  ]
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error('xlsx sidecar main.rs changed upstream; cannot apply: ' + from.slice(0, 60))
    src = src.replace(from, to)
  }
  // the stdio entry point still writes to stdout; keep it compiling against the new buffer type
  src = src.replace('let output: SharedOutput = Arc::new(Mutex::new(BufWriter::new(io::stdout())));', 'let output: SharedOutput = Arc::new(Mutex::new(Vec::new()));')
  return src.replace(/\n    fn new\(\) -> Self \{/g, '\n    pub(crate) fn new() -> Self {')
}

// 0. xlsx engine -> wasm (only needed for sheets)
mkdirSync(join(root, 'dist'), { recursive: true })
if (APPS.includes('sheets') && !existsSync(join(root, 'dist/xlsx.wasm'))) {
  const crate = join(root, '.build/xlsx-wasm')
  mkdirSync(join(crate, 'src'), { recursive: true })
  cpSync(join(root, 'native/xlsx-wasm/src/lib.rs'), join(crate, 'src/lib.rs'))
  writeFileSync(join(crate, 'src/sidecar_main.rs'), patchSidecarMain(readFileSync(join(upstream, 'apps/sheets/native/xlsx-engine/src/main.rs'), 'utf8')))
  writeFileSync(join(crate, 'Cargo.toml'), readFileSync(join(root, 'native/xlsx-wasm/Cargo.toml.tmpl'), 'utf8')
    .replace('@ENGINE@', wasiEngineCopy(crate)))
  run('rustup', ['target', 'add', 'wasm32-wasip1'], crate)
  run('cargo', ['build', '--release', '--target', 'wasm32-wasip1'], crate)
  cpSync(join(crate, 'target/wasm32-wasip1/release/xlsx_wasm.wasm'), join(root, 'dist/xlsx.wasm'))
}

// 1. shim: replaces Electron preload (window.desktop) with the in-page runtime (native bridge: office:// on the Tauri app)
const www = join(root, 'www')
rmSync(www, { recursive: true, force: true })
mkdirSync(www, { recursive: true })
const shimFile = null
// Per app: the real main-process module + how to start it. `open` = path from ?open= (launcher)
const PRINT_WASM = [['/app/wasm/pdfium.wasm', 'wasm/pdfium.wasm'], ['/app/wasm/harfbuzz-subset.wasm', 'wasm/harfbuzz-subset.wasm']]
const RUNTIMES = {
  docs: { file: 'docs-main', imports: 'registerDocsIpc, registerAiIpc, registerProjectIpc, openExternalDocx',
    code: 'registerDocsIpc(); registerAiIpc(); registerProjectIpc(); if (open) openExternalDocx(open)' },
  slides: { file: 'slides-main', imports: 'createSlidesView, registerAiIpc, registerProjectIpc',
    code: 'registerAiIpc(); registerProjectIpc(); createSlidesView(open)' },
  // a new spreadsheet starts from a blank backing workbook, as in the desktop shell (newSheetTab): the save pipeline
  // needs a real file, and its first Save goes through Save As (the name prompt) into Documents
  sheets: { file: 'sheets-main', imports: 'createSheetsView, registerProjectIpc, queueWorkbookForView, setSheetsNewBlank, markSheetsUnsavedNew, markSheetsUntitledPath',
    tools: "import { blankXlsxBuffer } from '" + upstream + "/packages/xlsx-gateway/src/gateway/csv-import'; import { newBlankSheet } from '" + join(root, 'shim/runtime/sheets-new.ts') + "'",
    code: 'createSheetsView(); registerProjectIpc(); if (open) queueWorkbookForView(webContents, open); else void newBlankSheet({ blankXlsxBuffer, markSheetsUnsavedNew, markSheetsUntitledPath, queueWorkbookForView, setSheetsNewBlank, webContents })' },
  pdf: { file: 'pdf-main', imports: 'createPdfView', code: 'createPdfView(open); registerAiIpc(); registerProjectIpc(); registerPdfTools(open)', tools: "import { registerPdfTools } from '" + join(root, 'shim/runtime/pdf-tools.ts') + "'; import { registerAiIpc, registerProjectIpc } from '" + upstream + "/apps/docs/src/main/docs-main'",
    preload: [['/app/wasm/pdfium.wasm', 'wasm/pdfium.wasm'], ['/app/wasm/harfbuzz-subset.wasm', 'wasm/harfbuzz-subset.wasm']] },
}
// 한글: the 이음오피스 desktop HWP app (hosts rhwp-studio). The studio is the one built in ieumoffice-ios/ (same
// 이음오피스 pin + AllEditor's iOS input patches, apps/hwp/scripts/rhwp-patches.mjs).
RUNTIMES.hwp = {
  file: 'hwp-main', imports: 'createHwpView',
  code: 'registerAiIpc(); registerProjectIpc(); createHwpView(open)',
  tools: `import { registerAiIpc, registerProjectIpc } from '${upstream}/apps/docs/src/main/docs-main'`,
  // its print panel (print-layout) renders the pages with PDFium, as the PDF editor does
  preload: [['/app/wasm/pdfium.wasm', 'wasm/pdfium.wasm'], ['/app/wasm/harfbuzz-subset.wasm', 'wasm/harfbuzz-subset.wasm']],
}
function prepareHwpStudio() {
  const ieumIos = join(root, 'ieumoffice-ios')
  run('npm', ['run', 'studio', '-w', '@genoffice/hwp'], ieumIos)
  // the HWP renderer's own SDK patch (sdk-scheme) must allow office:// too: use AllEditor's patch list
  cpSync(join(ieumIos, 'apps/hwp/scripts/rhwp-patches.mjs'), join(upstream, 'apps/hwp/scripts/rhwp-patches.mjs'))
  const dst = join(upstream, 'apps/hwp/public/studio')
  rmSync(dst, { recursive: true, force: true })
  cpSync(join(ieumIos, 'apps/hwp/public/studio'), dst, { recursive: true })
}
// bundled fonts: the folder the 한글 editor reads its font files from (studio/fonts); every editor shares it
function copyBundledFonts(studioDir) {
  cpSync(join(root, 'fonts'), join(studioDir, 'fonts'), { recursive: true, filter: (p) => !p.endsWith('.md') || p.endsWith('README.md') })
}
const bootFile = join(root, 'shim/runtime/boot.ts')

// 2. renderers
for (const app of APPS) {
  if (app === 'hwp') prepareHwpStudio()
  const appDir = join(upstream, 'apps', app)
  const out = join(www, app)
  run('npx', ['vite', 'build', '--config', 'vite.renderer.config.ts', '--outDir', out,
    '--emptyOutDir', '--base', `./`], appDir)
  {
    // every editor's print panel (print-layout) renders pages with PDFium
    mkdirSync(join(out, 'wasm'), { recursive: true })
    cpSync(join(upstream, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'), join(out, 'wasm/pdfium.wasm'))
    cpSync(join(upstream, 'node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'), join(out, 'wasm/harfbuzz-subset.wasm'))
  }
  if (app === 'sheets') cpSync(join(root, 'dist/xlsx.wasm'), join(out, 'xlsx.wasm'))
  if (app === 'hwp') copyBundledFonts(join(out, 'studio'))
  const rt = RUNTIMES[app]
  await bundleRuntime({
    upstream, outfile: join(out, 'runtime.js'), appendExports: {},
    entry: `
import '${bootFile}'
import '${upstream}/apps/${app}/src/preload/index.ts'
import { ${rt.imports} } from '${upstream}/apps/${app}/src/main/${rt.file}'
import { webContents } from '${root}/shim/runtime/electron'
${rt.tools ?? ''}
import { start } from '${root}/shim/runtime/start'
start('${app}', (open) => { ${rt.code} }, ${JSON.stringify(rt.preload ?? PRINT_WASM)})
`,
  })
  const idx = join(out, 'index.html')
  // runtime must run before the app bundle (module scripts are deferred, classic ones are not)
  writeFileSync(idx, readFileSync(idx, 'utf8').replace('<head>', '<head><script src="./runtime.js"></script>').replace(/script-src 'self'( 'wasm-unsafe-eval')?/, "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'").replace(/connect-src 'self'/, "connect-src 'self' https: wss: blob: data:"))
}

// 2b. AllEditor branding: the AI panel / ribbon entry read "AI", not the upstream product name "Genspark".
// Only these UI labels change; strings about the real Genspark provider (sign-in, credits) stay accurate.
const BRAND = [
  [/\b(ribbonAiAssistant|aiPanelTitle):"Genspark"/g, '$1:"AI"'],
  [/children:"Genspark AI"/g, 'children:"AI"'],
  // UI font served by the desktop shell's genoffice-app:// scheme -> bundled copy (www/ui-fonts, see below)
  [/genoffice-app:\/\/ui-fonts\//g, '../../ui-fonts/'],
  // panel header: [icon, "Genspark"] (Sheets, PDF)
  [/(className:"ai-panel-title",children:\[[^\]]{0,60}?),"Genspark"\]/g, '$1,"AI"]'],
]
const uiFonts = join(upstream, 'packages/ui/ui-fonts')
if (existsSync(uiFonts)) cpSync(uiFonts, join(www, 'ui-fonts'), { recursive: true, filter: (p) => !/README|\.md$/i.test(p) || p === uiFonts })
for (const app of APPS) {
  const dir = join(www, app, 'assets')
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js') || n.endsWith('.css'))) {
    const p = join(dir, f); const src = readFileSync(p, 'utf8')
    let out = src
    for (const [re, to] of BRAND) out = out.replace(re, to)
    if (out !== src) writeFileSync(p, out)
  }
}

// 3. launcher
cpSync(join(root, 'web/index.html'), join(www, 'index.html'))
cpSync(join(root, 'ieumoffice-ios/apps/mobile/src/renderer/assets/brand/alleditor-icon.svg'), join(www, 'alleditor-icon.svg'))
await bundleRuntime({
  upstream, outfile: join(www, 'home.js'),
  entry: `import '${bootFile}'\nimport '${root}/shim/home/home'\n`,
})
// 4. the office suite the iOS app bundles (Xcode folder reference `office`, served on office://)
const office = join(root, 'office')
rmSync(office, { recursive: true, force: true })
cpSync(www, office, { recursive: true })
console.log('www/ and office/ ready:', APPS.join(', '))

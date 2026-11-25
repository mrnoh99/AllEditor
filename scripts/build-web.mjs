// Builds the upstream GenOffice renderers as plain web apps and assembles www/ for Capacitor.
//   UPSTREAM_DIR=/path/to/genoffice node scripts/build-web.mjs   (skip cloning)
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { bundleRuntime } from './runtime-bundle.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'https://github.com/pblsketch/ieumoffice' // 이음오피스 (GenOffice-based), Apache-2.0
const PINNED = 'ad22c056a9d217f11079a4dc30df12ccf233f8d3'
const upstream = process.env.UPSTREAM_DIR ?? join(root, '.upstream')
const APPS = (process.env.APPS ?? 'docs,slides,sheets,pdf,hwp,markdown,html,mindmap,diagram,epub,whiteboard').split(',') // renderer apps to bundle
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

if (!existsSync(join(upstream, 'package.json'))) {
  run('git', ['clone', REPO, upstream], root)
  run('git', ['checkout', PINNED], upstream)
}
if (!existsSync(join(upstream, 'node_modules'))) {
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], upstream)
}

// 0. xlsx engine -> wasm (only needed for sheets)
mkdirSync(join(root, 'dist'), { recursive: true })
if (APPS.includes('sheets') && !existsSync(join(root, 'dist/xlsx.wasm'))) {
  const crate = join(root, '.build/xlsx-wasm')
  mkdirSync(join(crate, 'src'), { recursive: true })
  cpSync(join(root, 'native/xlsx-wasm/src/lib.rs'), join(crate, 'src/lib.rs'))
  writeFileSync(join(crate, 'Cargo.toml'), readFileSync(join(root, 'native/xlsx-wasm/Cargo.toml.tmpl'), 'utf8')
    .replace('@ENGINE@', join(upstream, 'apps/sheets/native/xlsx-engine')))
  run('rustup', ['target', 'add', 'wasm32-wasip1'], crate)
  run('cargo', ['build', '--release', '--target', 'wasm32-wasip1'], crate)
  cpSync(join(crate, 'target/wasm32-wasip1/release/xlsx_wasm.wasm'), join(root, 'dist/xlsx.wasm'))
}

// 1. shim: replaces Electron preload (window.desktop) with Capacitor-backed implementation
const www = join(root, 'www')
rmSync(www, { recursive: true, force: true })
mkdirSync(www, { recursive: true })
const shimFile = null
// Per app: the real main-process module + how to start it. `open` = path from ?open= (launcher)
const AI = 'registerAiIpc, registerProjectIpc' // shell-level, from docs-main
const docsAi = (up) => `import { ${AI} } from '${up}/apps/docs/src/main/docs-main'`
const RUNTIMES = {
  docs: { file: 'docs-main', imports: 'registerDocsIpc, createDocsView, registerAiIpc, registerProjectIpc',
    code: 'registerAiIpc(); registerProjectIpc(); registerDocsIpc(); createDocsView(open || undefined)' },
  slides: { file: 'slides-main', imports: 'createSlidesView, registerAiIpc, registerProjectIpc',
    code: 'registerAiIpc(); registerProjectIpc(); createSlidesView(open)' },
  sheets: { file: 'sheets-main', imports: 'createSheetsView, registerProjectIpc, queueWorkbookForView, setSheetsNewBlank',
    code: 'createSheetsView(); registerProjectIpc(); if (open) queueWorkbookForView(webContents, open); else setSheetsNewBlank()' },
  pdf: { file: 'pdf-main', imports: 'createPdfView', code: 'registerAiIpc(); registerProjectIpc(); createPdfView(open); registerPdfTools(open)', shared: true,
    tools: (up) => `import { registerPdfTools } from '${root}/shim/runtime/pdf-tools.ts'`,
    preload: [['/app/wasm/pdfium.wasm', 'wasm/pdfium.wasm'], ['/app/wasm/harfbuzz-subset.wasm', 'wasm/harfbuzz-subset.wasm']] },
  hwp: { file: 'hwp-main', imports: 'createHwpView', code: 'registerAiIpc(); registerProjectIpc(); createHwpView(open)', shared: true },
  markdown: { file: 'markdown-main', imports: 'createMarkdownView', code: 'registerAiIpc(); registerProjectIpc(); createMarkdownView(open)', shared: true },
  html: { file: 'html-main', imports: 'createHtmlView', code: 'registerAiIpc(); registerProjectIpc(); createHtmlView(open)', shared: true },
  mindmap: { file: 'mindmap-main', imports: 'createMindmapView', code: 'registerAiIpc(); registerProjectIpc(); createMindmapView(open)', shared: true },
  diagram: { file: 'diagram-main', imports: 'createDiagramView', code: 'registerAiIpc(); registerProjectIpc(); createDiagramView(open)', shared: true },
  epub: { file: 'epub-main', imports: 'createEpubView', code: 'registerAiIpc(); registerProjectIpc(); createEpubView(open)', shared: true },
  whiteboard: { file: 'whiteboard-main', imports: 'createWhiteboardView', code: 'registerAiIpc(); registerProjectIpc(); createWhiteboardView()', shared: true },
}
const bootFile = join(root, 'shim/runtime/boot.ts')

// 2. renderers
const built = []
for (const app of APPS) {
try {
  const appDir = join(upstream, 'apps', app)
  const out = join(www, app)
  if (app === 'hwp') run('npm', ['run', 'studio', '-w', '@genoffice/hwp'], upstream) // rhwp-studio bundle
  run('npx', ['vite', 'build', '--config', 'vite.renderer.config.ts', '--outDir', out,
    '--emptyOutDir', '--base', `./`], appDir)
  if (app === 'pdf') {
    mkdirSync(join(out, 'wasm'), { recursive: true })
    cpSync(join(upstream, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'), join(out, 'wasm/pdfium.wasm'))
    cpSync(join(upstream, 'node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'), join(out, 'wasm/harfbuzz-subset.wasm'))
  }
  if (app === 'sheets') cpSync(join(root, 'dist/xlsx.wasm'), join(out, 'xlsx.wasm'))
  const rt = RUNTIMES[app]
  await bundleRuntime({
    upstream, outfile: join(out, 'runtime.js'), appendExports: {},
    entry: `
import '${bootFile}'
import '${upstream}/apps/${app}/src/preload/index.ts'
import { ${rt.imports} } from '${upstream}/apps/${app}/src/main/${rt.file}'
import { webContents } from '${root}/shim/runtime/electron'
${typeof rt.tools === 'function' ? rt.tools(upstream) : (rt.tools ?? '')}
${rt.shared ? docsAi(upstream) : ''}
import { start } from '${root}/shim/runtime/start'
start('${app}', (open) => { ${rt.code} }, ${JSON.stringify(rt.preload ?? [])})
`,
  })
  const idx = join(out, 'index.html')
  // runtime must run before the app bundle (module scripts are deferred, classic ones are not)
  writeFileSync(idx, readFileSync(idx, 'utf8').replace('<head>', '<head><script src="./runtime.js"></script>').replace(/script-src 'self'( 'wasm-unsafe-eval')?/, "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'").replace(/connect-src 'self'/, "connect-src 'self' https: wss: blob: data:"))
  built.push(app)
} catch (e) { console.error(`[build] ${app} FAILED:`, String(e?.message ?? e).slice(0, 400)); rmSync(join(www, app), { recursive: true, force: true }) }
}
writeFileSync(join(www, 'apps.json'), JSON.stringify(built))

// 3. launcher
cpSync(join(root, 'web/index.html'), join(www, 'index.html'))
await bundleRuntime({
  upstream, outfile: join(www, 'home.js'),
  entry: `import '${bootFile}'\nimport '${root}/shim/home/home'\n`,
})
console.log('www/ ready:', APPS.join(', '))

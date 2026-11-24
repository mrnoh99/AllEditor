// Replaces the Electron preload bridge (`window.desktop`) inside iOS WKWebView.
// Implemented: settings defaults, open (file picker), save / save-as / save-new into the
// app's Documents folder. Every other DesktopApi member degrades to a harmless no-op
// (`on*` -> unsubscribe fn, everything else -> resolved undefined) so the editor still boots.
import { Directory, Filesystem } from '@capacitor/filesystem'

const DIR = Directory.Documents
const sleepUnsub = () => () => {}

const sha256 = async (buf: ArrayBuffer): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')

const toBase64 = (buf: ArrayBuffer): string => {
  let s = ''
  const u = new Uint8Array(buf)
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromBase64 = (b64: string): ArrayBuffer => {
  const bin = atob(b64)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u.buffer
}
const blobUrl = (buf: ArrayBuffer, type = 'application/octet-stream') =>
  URL.createObjectURL(new Blob([buf], { type }))

const baseName = (p: string) => p.split('/').pop() ?? p
const safeName = (n: string) => n.replace(/[\\/:*?"<>|]/g, '_') || 'Untitled.docx'

/** Opens the iOS document picker (Files app, iCloud Drive…) */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    input.onchange = () => { resolve(input.files?.[0] ?? null); input.remove() }
    input.oncancel = () => { resolve(null); input.remove() }
    document.body.appendChild(input)
    input.click()
  })
}

async function writeDoc(path: string, data: ArrayBuffer) {
  await Filesystem.writeFile({ path, directory: DIR, data: toBase64(data), recursive: true })
}

/** import a picked file into Documents so later saves have a stable path */
async function importPicked(file: File) {
  const buf = await file.arrayBuffer()
  const path = safeName(file.name)
  await writeDoc(path, buf)
  return { path, name: file.name, dataUrl: blobUrl(buf), hash: await sha256(buf) }
}

const pending: Record<string, unknown> = {}
let recent: string[] = []

const impl: Record<string, (...a: any[]) => unknown> = {
  getLanguage: async () => {
    const l = navigator.language.slice(0, 2)
    return ['zh', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar'].includes(l) ? l : 'en'
  },
  getSystemLocale: async () => navigator.language,
  getTheme: async () => 'system',
  getDocumentTheme: async () => 'follow',
  getAutoSaveDefault: async () => ({ on: true, updatedAt: 0 }),
  getAuthorName: async () => '',
  getMeasurementUnit: async () => null,
  setMeasurementUnit: async () => undefined,
  getAiPanelPrefs: async () => null,
  getKeyOverrides: async () => ({}),
  setKeyOverrides: async (o: unknown) => o ?? {},
  zoteroAvailable: async () => false,
  getRecentFiles: async () => recent,
  consumePendingOpenDocx: async () => null,
  consumeNewBlankDoc: async () => false,
  consumeAiDocContent: async () => null,
  consumeHeadlessExport: async () => null,
  confirmDocumentReplace: async () => true,
  spellIsMisspelled: () => false,
  spellSuggestions: () => [],
  getPathForFile: (f: File) => f.name,

  openDocx: async () => {
    const f = await pickFile('.docx,.dotx,application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    if (!f) return null
    const r = await importPicked(f)
    recent = [r.path, ...recent.filter((p) => p !== r.path)].slice(0, 20)
    return r
  },
  pickDocx: async () => {
    const f = await pickFile('.docx,.dotx')
    if (!f) return null
    const buf = await f.arrayBuffer()
    return { name: f.name, path: safeName(f.name), dataUrl: blobUrl(buf) }
  },
  openDocxPath: async (path: string) => {
    try {
      const { data } = await Filesystem.readFile({ path, directory: DIR })
      const buf = fromBase64(data as string)
      return { path, name: baseName(path), dataUrl: blobUrl(buf), hash: await sha256(buf) }
    } catch { return null }
  },
  saveDocx: async (path: string, data: ArrayBuffer) => {
    try { await writeDoc(path, data); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  },
  saveDocxNew: async (defaultName: string, data: ArrayBuffer) => {
    try {
      const path = safeName(defaultName)
      await writeDoc(path, data)
      return { ok: true, path }
    } catch (e) { return { ok: false, error: String(e) } }
  },
  // iOS has no save dialog: write to Documents (visible in Files app > AllEditor)
  saveDocxAs: async (defaultName: string, data: ArrayBuffer) => impl.saveDocxNew(defaultName, data),
  saveDocxTo: async (path: string, data: ArrayBuffer) => impl.saveDocx(path, data),
  writeRecoveryCopy: async (path: string, data: ArrayBuffer) => {
    try { await writeDoc(`.recovery/${baseName(path) || 'untitled'}`, data); return { ok: true } }
    catch { return { ok: false } }
  },
}

const desktop = new Proxy(impl, {
  get(target, key: string) {
    if (key in target) return target[key]
    if (/^on[A-Z]/.test(key)) return sleepUnsub
    return async () => pending[key]
  },
})
;(window as unknown as { desktop: unknown }).desktop = desktop

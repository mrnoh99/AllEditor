// Native bridge of the office suite: the Tauri app (ieumoffice-ios/) serves the suite on office:// and answers
// POST office://localhost/__ae/<plugin>/<method> (src-tauri/src/office.rs + AllEditorOfficePlugin.swift).
// In a desktop browser (development) there is no native host: files live in IndexedDB, PDF/print are unavailable.
// Directory.Documents = app Documents (visible in Files.app); Directory.Support = private app data.

/** true inside the Tauri app (pages loaded from the office:// scheme, or forced for tests) */
export const isTauriOffice = () => {
  const g = globalThis as any
  if (g.__AE_NATIVE__ === 'tauri') return true
  try { return location.protocol === 'office:' || location.hostname === 'office.localhost' } catch { return false }
}
/** a native host is present */
export const isNative = () => isTauriOffice()

const tauriBase = () => ((globalThis as any).__AE_NATIVE_BASE__ as string | undefined) ?? '/__ae/'
async function tauriCall(plugin: string, method: string, args: object): Promise<any> {
  const r = await fetch(tauriBase() + plugin + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })
  let body: any = null
  try { body = await r.json() } catch {}
  if (!r.ok || body?.error) throw new Error(body?.error ?? `${plugin}.${method} failed (${r.status})`)
  return body ?? {}
}
/** plugin proxy: office:// fetch on the Tauri app */
function bridge<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_t, method: string) => (args: object = {}) => {
      if (isTauriOffice()) return tauriCall(name, method, args)
      return Promise.reject(new Error(`${name}.${method}: needs the iOS app`))
    },
  })
}

type Dir = 'documents' | 'support'
interface AEFiles {
  readFile(o: { path: string; dir: Dir }): Promise<{ data: string }>
  writeFile(o: { path: string; data: string; dir: Dir }): Promise<void>
  deleteFile(o: { path: string; dir: Dir }): Promise<void>
  readdir(o: { path: string; dir: Dir }): Promise<{ files: Array<{ name: string; type: string; size: number; mtime: number }> }>
}
const plugin = bridge<AEFiles>('AEFiles')

export const Directory = { Documents: 'documents', Support: 'support' } as const
type D = (typeof Directory)[keyof typeof Directory]
const dir = (d?: string): Dir => (d === 'support' ? 'support' : 'documents')
export const Filesystem = {
  readFile: (o: { path: string; directory?: D }) => plugin.readFile({ path: o.path, dir: dir(o.directory) }),
  writeFile: (o: { path: string; directory?: D; data: string; recursive?: boolean }) => plugin.writeFile({ path: o.path, data: o.data, dir: dir(o.directory) }),
  deleteFile: (o: { path: string; directory?: D }) => plugin.deleteFile({ path: o.path, dir: dir(o.directory) }),
  readdir: (o: { path: string; directory?: D }) => plugin.readdir({ path: o.path, dir: dir(o.directory) }),
}

// ---- AEPdf: HTML -> PDF through an offscreen WKWebView + UIPrintPageRenderer ----
interface AEPdf { render(o: { html: string; width: number; height: number }): Promise<{ data: string }> }
const pdfPlugin = bridge<AEPdf>('AEPdf')
/** page size in points; returns the PDF bytes */
export async function renderPdfNative(html: string, widthPt: number, heightPt: number): Promise<Uint8Array> {
  const { data } = await pdfPlugin.render({ html, width: widthPt, height: heightPt })
  const bin = atob(data); const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

// ---- AEPrint: iOS print dialog and direct network printing (IPP / raw 9100) ----
interface AEPrint {
  printPdf(o: { data: string; jobName: string }): Promise<{ completed: boolean }>
  directPrint(o: { host: string; port?: number; protocol: string; data: string; jobName: string; copies?: number; sides?: string }): Promise<{ via: string }>
}
const printPlugin = bridge<AEPrint>('AEPrint')
const toB64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
export const nativePrintDialog = (pdf: Uint8Array, jobName: string) => printPlugin.printPdf({ data: toB64(pdf), jobName })
export const nativeDirectPrint = (o: { host: string; port?: number; protocol: string; pdf: Uint8Array; jobName: string; copies?: number; sides?: string }) =>
  printPlugin.directPrint({ host: o.host, port: o.port, protocol: o.protocol, data: toB64(o.pdf), jobName: o.jobName, copies: o.copies, sides: o.sides })

// ---- AEShare: iOS share sheet (send a document to Pages / Keynote / Numbers, Files, Mail, …) ----
interface AEShare { share(o: { name: string; mime: string; data: string }): Promise<unknown> }
const sharePlugin = bridge<AEShare>('AEShare')
export const nativeShare = (name: string, mime: string, bytes: Uint8Array) => sharePlugin.share({ name, mime, data: toB64(bytes) })

// ---- AEApp.openUrl: open a link in Safari (key pages of the AI providers, help links) ----
interface AEApp { openUrl(o: { url: string }): Promise<unknown> }
const appPlugin = bridge<AEApp>('AEApp')
export const nativeOpenUrl = (url: string) => appPlugin.openUrl({ url })
/** version (tauri.conf.json) and build number (CI) of the app */
export const nativeAppVersion = () => (appPlugin as any).version() as Promise<{ version: string; build: string }>

// ---- AEAi: the app's one AI setting (이음오피스 store in Rust, keys sealed); see src-tauri/src/office.rs ----
export interface AiSnapshot { selectedProvider: string; modelByProvider: Record<string, string>; configuredProviders: Record<string, { hasKey: boolean; models: string[] }> }
interface AEAi { get(): Promise<AiSnapshot>; set(o: { provider: string; apiKey?: string; model?: string }): Promise<AiSnapshot>; export(): Promise<{ provider: string; providers: Record<string, { apiKey: string; model: string }> }> }
const aiPlugin = bridge<AEAi>('AEAi')
export const nativeAi = { get: () => aiPlugin.get(), set: (o: { provider: string; apiKey?: string; model?: string }) => aiPlugin.set(o), export: () => aiPlugin.export() }

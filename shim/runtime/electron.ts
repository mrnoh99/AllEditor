import { isNative, nativeOpenUrl } from './native-files'
// Minimal in-page "Electron": ipcMain/ipcRenderer talk directly, dialogs are iOS pickers,
// everything else is an inert deep Proxy so unported features no-op instead of crashing.
import fs, { DOCS_ROOT, flush } from './fs'
import { printCurrentDocument, htmlToPdf, printerChoices, sendToPrinter, pageInchesFromElectron } from './print'

const g = globalThis as any
let readyResolve!: () => void
export const runtimeReady = new Promise<void>((r) => (readyResolve = r))
export const markReady = () => readyResolve()

type Fn = (...a: any[]) => any
const handlers = new Map<string, Fn>()
const onMain = new Map<string, Set<Fn>>()
const onRenderer = new Map<string, Set<Fn>>()
const add = (m: Map<string, Set<Fn>>, k: string, f: Fn) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(f)

/** deep inert stub: callable, any property is another stub, awaits to itself-less undefined */
export function inert(name = 'stub'): any {
  const f: any = function () { return undefined }
  return new Proxy(f, {
    get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => name : inert(`${name}.${String(k)}`)),
    apply: () => undefined,
    construct: () => inert(name),
  })
}

export const webContents: any = {
  fromId: () => wcProxy, getAllWebContents: () => [wcProxy], getFocusedWebContents: () => wcProxy,
  id: 1, session: inert('session'),
  on: () => webContents, once: () => webContents, off: () => webContents, removeListener: () => webContents,
  send: (ch: string, ...a: any[]) => { for (const l of onRenderer.get(ch) ?? []) l({ sender: webContents }, ...a) },
  isDestroyed: () => false, getURL: () => location.href, isFocused: () => true,
  printToPDF: async (o: any = {}) => Buffer.from(await printCurrentDocument(o)),
  getPrintersAsync: async () => printerChoices(),
  print: (o: any = {}, cb?: (ok: boolean, reason?: string) => void) => {
    void (async () => {
      try {
        const [w, h] = pageInchesFromElectron(o)
        const pdf = await printCurrentDocument({ pageSize: { width: w, height: h }, scale: o.scaleFactor ? o.scaleFactor / 100 : 1 })
        const done = await sendToPrinter(pdf, o, document.title || 'AllEditor')
        cb?.(done, done ? undefined : 'cancelled')
      } catch (e: any) { cb?.(false, String(e?.message ?? e)) }
    })()
  },
  getOwnerBrowserWindow: () => browserWindow,
}
const wcProxy = new Proxy(webContents, { get: (t, k) => (k in t ? t[k] : inert(`webContents.${String(k)}`)) })
const browserWindow: any = new Proxy({ id: 1, webContents: wcProxy, isDestroyed: () => false, isVisible: () => true,
  isFocused: () => true, isMinimized: () => false, isFullScreen: () => false, isMaximized: () => false }, {
  get: (t: any, k) => (k in t ? t[k] : inert(`win.${String(k)}`)),
})
/** hidden export windows (slides/sheets build an HTML file, load it, printToPDF it) */
function makeFakeWindow() {
  let html = ''
  const wc: any = new Proxy({
    id: 2, send() {}, isDestroyed: () => false, on: () => wc, once: () => wc, off: () => wc, removeListener: () => wc, session: inert('session'),
    setWindowOpenHandler: () => {}, executeJavaScript: async () => true, insertCSS: async () => '',
    printToPDF: async (o: any = {}) => Buffer.from(await htmlToPdf(html, o)),
    getPrintersAsync: async () => printerChoices(),
    print: (o: any = {}, cb?: (ok: boolean, reason?: string) => void) => {
      void (async () => {
        try {
          const [w, h] = pageInchesFromElectron(o)
          const pdf = await htmlToPdf(html, { pageSize: { width: w, height: h } })
          const done = await sendToPrinter(pdf, o, 'AllEditor')
          cb?.(done, done ? undefined : 'cancelled')
        } catch (e: any) { cb?.(false, String(e?.message ?? e)) }
      })()
    },
  }, { get: (t: any, k) => (k in t ? t[k] : inert(`fakewc.${String(k)}`)) })
  const win: any = new Proxy({
    webContents: wc, isDestroyed: () => false, destroy() {}, close() {}, hide() {}, show() {}, setBounds() {},
    loadFile: async (p: string) => { html = String(fs.readFileSync(p, 'utf8')) },
    loadURL: async (u: string) => {
      if (u.startsWith('data:')) { const i = u.indexOf(','); html = /;base64/.test(u.slice(0, i)) ? atob(u.slice(i + 1)) : decodeURIComponent(u.slice(i + 1)) }
      else if (u.startsWith('file://')) html = String(fs.readFileSync(decodeURIComponent(u.slice(7)), 'utf8'))
    },
  }, { get: (t: any, k) => (k in t ? t[k] : inert(`fakewin.${String(k)}`)) })
  return win
}
export const BrowserWindow: any = Object.assign(function () { return makeFakeWindow() }, {
  fromWebContents: () => browserWindow, fromId: () => browserWindow, getAllWindows: () => [browserWindow],
  getFocusedWindow: () => browserWindow,
})

const mainListenerEvent = () => ({ sender: wcProxy, senderFrame: inert('frame'), returnValue: undefined as any, reply: (ch: string, ...a: any[]) => webContents.send(ch, ...a) })

export const ipcMain: any = {
  handle: (ch: string, f: Fn) => { handlers.set(ch, f) },
  handleOnce: (ch: string, f: Fn) => { handlers.set(ch, f) },
  removeHandler: (ch: string) => { handlers.delete(ch) },
  on(ch: string, f: Fn) { add(onMain, ch, f); return ipcMain },
  once(ch: string, f: Fn) { add(onMain, ch, f); return ipcMain },
  off(ch: string, f: Fn) { onMain.get(ch)?.delete(f); return ipcMain },
  removeListener(ch: string, f: Fn) { onMain.get(ch)?.delete(f); return ipcMain },
  removeAllListeners(ch?: string) { ch ? onMain.delete(ch) : onMain.clear(); return ipcMain },
  /** test/launcher hook: replace a handler (the real one stays reachable as `prev`) */
  _get: (ch: string) => handlers.get(ch),
}
export const ipcRenderer: any = {
  async invoke(ch: string, ...a: any[]) {
    await runtimeReady
    if ((globalThis as any).__aeIpcTrace) console.log('[ipc>]', ch, JSON.stringify(a).slice(0, 300))
    const h = handlers.get(ch)
    if (!h) { console.warn('[ipc] no handler for', ch); return undefined }
    try { return await h({ sender: wcProxy, senderFrame: inert('frame') }, ...a) }
    catch (e: any) { console.warn('[ipc] handler failed:', ch, e?.message ?? e); throw e }
  },
  send(ch: string, ...a: any[]) {
    runtimeReady.then(() => { for (const l of onMain.get(ch) ?? []) l(mainListenerEvent(), ...a) })
  },
  sendSync(ch: string, ...a: any[]) {
    const ev = mainListenerEvent(); for (const l of onMain.get(ch) ?? []) l(ev, ...a); return ev.returnValue
  },
  on(ch: string, f: Fn) { add(onRenderer, ch, f); return ipcRenderer },
  once(ch: string, f: Fn) { add(onRenderer, ch, f); return ipcRenderer },
  off(ch: string, f: Fn) { onRenderer.get(ch)?.delete(f); return ipcRenderer },
  removeListener(ch: string, f: Fn) { onRenderer.get(ch)?.delete(f); return ipcRenderer },
  removeAllListeners(ch?: string) { ch ? onRenderer.delete(ch) : onRenderer.clear(); return ipcRenderer },
}
export const contextBridge: any = { exposeInMainWorld: (n: string, v: unknown) => { g[n] = v } }

// ---- dialogs ---------------------------------------------------------------
const base = (p: string) => p.split('/').pop() || p
const uniq = (dir: string, name: string) => {
  const dot = name.lastIndexOf('.'); const stem = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : ''
  let p = `${dir}/${name}`, i = 1
  while (fs.existsSync(p)) p = `${dir}/${stem} ${i++}${ext}`
  return p
}
function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple
    i.style.display = 'none'
    i.onchange = () => { resolve([...(i.files ?? [])]); i.remove() }
    i.oncancel = () => { resolve([]); i.remove() }
    document.body.appendChild(i); i.click()
  })
}
/** copy a picked File into Documents so it has a real path the app code can read/save */
export async function importFile(f: File): Promise<string> {
  const p = uniq(DOCS_ROOT, f.name.replace(/[\\/:*?"<>|]/g, '_'))
  fs.writeFileSync(p, new Uint8Array(await f.arrayBuffer()))
  return p
}
export const dialog: any = {
  async showOpenDialog(a: any, b?: any) {
    const o = b ?? a ?? {}
    if (o.properties?.includes('openDirectory') && !o.properties?.includes('openFile')) return { canceled: false, filePaths: [DOCS_ROOT] }
    const exts = (o.filters ?? []).flatMap((x: any) => x.extensions ?? []).filter((e: string) => e !== '*')
    const files = await pickFiles(exts.map((e: string) => '.' + e).join(','), !!o.properties?.includes('multiSelections'))
    if (!files.length) return { canceled: true, filePaths: [] }
    return { canceled: false, filePaths: await Promise.all(files.map(importFile)) }
  },
  async showSaveDialog(a: any, b?: any) {
    const o = b ?? a ?? {}
    const name = base(o.defaultPath || 'Untitled')
    const ext = o.filters?.[0]?.extensions?.[0]
    const full = ext && ext !== '*' && !name.includes('.') ? `${name}.${ext}` : name
    // AllEditor: ask for the name, as the desktop save panel does (the extension is kept); saved in Documents
    const dot = full.lastIndexOf('.'), stem = dot > 0 ? full.slice(0, dot) : full, extn = dot > 0 ? full.slice(dot) : ''
    let ko = true
    try { ko = (JSON.parse(localStorage.getItem('alleditor.settings') || '{}').language ?? 'ko') !== 'en' } catch {}
    const typed = prompt(ko ? `저장할 이름 (${extn || '확장자 없음'} 은 그대로 둡니다)\n파일 앱 › AllEditor 에 저장됩니다.` : `Name to save as (${extn || 'no extension'} is kept)\nSaved in Files › AllEditor.`, stem)
    if (typed === null) return { canceled: true, filePath: undefined }
    const clean = typed.trim().replace(/[\\/:*?"<>|]/g, '_').replace(new RegExp((extn || '$^').replace('.', '\\.') + '$', 'i'), '') || stem
    return { canceled: false, filePath: uniq(DOCS_ROOT, clean + extn) }
  },
  async showMessageBox(a: any, b?: any) {
    const o = b ?? a ?? {}
    const buttons: string[] = o.buttons ?? ['OK']
    const ok = buttons.length < 2 ? (alert(`${o.message ?? ''}\n${o.detail ?? ''}`), true) : confirm(`${o.message ?? ''}\n${o.detail ?? ''}\n\n[OK] ${buttons[o.defaultId ?? 0]}  [Cancel] ${buttons[o.cancelId ?? buttons.length - 1]}`)
    return { response: ok ? (o.defaultId ?? 0) : (o.cancelId ?? buttons.length - 1), checkboxChecked: false }
  },
  showMessageBoxSync: () => 0,
  showErrorBox: (t: string, c: string) => alert(`${t}\n${c}`),
}

export const app: any = {
  getPath: (n: string) => (n === 'documents' || n === 'downloads' || n === 'desktop' || n === 'home' ? DOCS_ROOT : n === 'temp' ? '/tmp' : '/userData' + (n === 'userData' ? '' : '/' + n)),
  getName: () => 'AllEditor', getVersion: () => '0.1.0', getLocale: () => navigator.language,
  getAppPath: () => '/app', isPackaged: true, whenReady: () => Promise.resolve(), isReady: () => true,
  getSystemLocale: () => navigator.language, getPreferredSystemLanguages: () => [...navigator.languages],
  on: () => app, once: () => app, off: () => app, removeListener: () => app, quit: () => {}, exit: () => {},
  addRecentDocument: () => {}, setBadgeCount: () => {}, focus: () => {},
}
export const shell: any = {
  openExternal: async (u: string) => { await openExternalUrl(u) }, openPath: async (p: string) => { try { await flush(); if (window.parent !== window) window.parent.postMessage({ type: 'ae-open', path: p }, '*') } catch {} return '' },
  showItemInFolder: () => {}, beep: () => {}, trashItem: async (p: string) => { fs.rmSync(p, { force: true, recursive: true }) },
}
export const clipboard: any = {
  readText: () => '', writeText: (t: string) => { navigator.clipboard?.writeText(t).catch(() => {}) },
  readHTML: () => '', writeHTML: () => {}, read: () => '', clear: () => {}, availableFormats: () => [],
  readImage: () => inert('img'), writeImage: () => {}, has: () => false,
}
export const nativeTheme: any = { shouldUseDarkColors: matchMedia('(prefers-color-scheme: dark)').matches, themeSource: 'system', on: () => {}, off: () => {} }
export const webFrame: any = { isWordMisspelled: () => false, getWordSuggestions: () => [], setZoomFactor: () => {}, getZoomFactor: () => 1 }
export const webUtils: any = { getPathForFile: (f: File) => f.name }
export const screen: any = { getPrimaryDisplay: () => ({ workAreaSize: { width: innerWidth, height: innerHeight }, scaleFactor: devicePixelRatio, bounds: { x: 0, y: 0, width: innerWidth, height: innerHeight }, workArea: { x: 0, y: 0, width: innerWidth, height: innerHeight } }), getAllDisplays: () => [], on: () => {} }
export const net: any = { fetch: (...a: any[]) => (fetch as any)(...a), request: () => inert('req'), isOnline: () => navigator.onLine }
export const nativeImage: any = inert('nativeImage')
const protoHandlers = new Map<string, Fn>()
export const protocol: any = {
  handle: (scheme: string, f: Fn) => { protoHandlers.set(scheme, f) },
  unhandle: (scheme: string) => { protoHandlers.delete(scheme) },
  isProtocolHandled: (s: string) => protoHandlers.has(s),
  registerSchemesAsPrivileged: () => {}, registerFileProtocol: () => {}, registerStreamProtocol: () => {}, interceptFileProtocol: () => {},
}
/** Safari (or the app registered for the link) via the native host; a plain window.open in a desktop browser */
export async function openExternalUrl(u: string) {
  if (!/^(https?|mailto):/i.test(u)) return
  if (isNative()) { try { await nativeOpenUrl(u); return } catch {} }
  window.open(u, '_blank')
}
const realFetch = g.fetch?.bind(g)
g.__realFetch = realFetch
g.fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  const h = m && protoHandlers.get(m[1])
  if (h) { await runtimeReady; return h(input instanceof Request ? input : new Request(url, init)) }
  // the desktop app calls Claude's API from its main process; from a WebView Anthropic asks for this opt-in header
  if (/^https:\/\/api\.anthropic\.com\//.test(url)) {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set('anthropic-dangerous-direct-browser-access', 'true')
    return realFetch(input, { ...init, headers })
  }
  return realFetch(input, init)
}
export const session: any = inert('session')
export const Menu: any = inert('Menu')
export const MenuItem: any = inert('MenuItem')
export const Notification: any = inert('Notification')
export const safeStorage: any = { isEncryptionAvailable: () => false, encryptString: (s: string) => new TextEncoder().encode(s), decryptString: (b: Uint8Array) => new TextDecoder().decode(b) }
export const powerSaveBlocker: any = inert('psb')
export const globalShortcut: any = inert('gs')
export const systemPreferences: any = inert('sp')
export const utilityProcess: any = inert('up')
export const WebContentsView: any = function () { return new Proxy({ webContents: wcProxy }, { get: (t: any, k) => (k in t ? t[k] : inert(`view.${String(k)}`)) }) }
export const crashReporter: any = inert('cr')
export const autoUpdater: any = inert('au')
export const desktopCapturer: any = inert('dc')
export const Tray: any = inert('Tray')
export const MessageChannelMain: any = inert('MCM')
export const BaseWindow: any = BrowserWindow
export const powerMonitor: any = inert('pm')
export const webContentsApi = webContents
export { flush }
export default { ipcMain, ipcRenderer, contextBridge, dialog, app, shell, clipboard, BrowserWindow, webContents, webFrame, webUtils, screen, net, nativeImage, protocol, session, nativeTheme, Menu }

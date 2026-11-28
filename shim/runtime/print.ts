// printToPDF for the in-page "Electron": snapshot the live document (or a fake hidden window's HTML)
// into a self-contained HTML string and let the native side paginate it with @media print rules.
import { renderPdfNative, nativePrintDialog, nativeDirectPrint, isNative, Filesystem, Directory } from './native-files'

const toDataUrl = async (src: string): Promise<string | null> => {
  try {
    const r = await fetch(src); const b = await r.blob()
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(null); fr.readAsDataURL(b) })
  } catch { return null }
}

/** self-contained copy of the current document: styles inlined, images/canvases as data URLs */
export async function snapshotDocument(scale = 1): Promise<string> {
  const live = document.documentElement
  const clone = live.cloneNode(true) as HTMLElement
  // AllEditor's own on-screen controls float over the document: none of them belongs on paper or in a PDF
  clone.querySelectorAll('#ae-home, #ae-file, #ae-ai-toggle, #ae-pen, #ae-eraser, #ae-viewer-exit, #ae-viewer-page, .ae-fab, .toast').forEach((n) => n.remove())
  clone.querySelectorAll('script, link[rel=preload], link[rel=modulepreload], iframe, video, audio').forEach((n) => n.remove())
  // styles: replace <link rel=stylesheet> and <style> by the cssText of the live sheets (keeps @media print)
  clone.querySelectorAll('link[rel=stylesheet], style').forEach((n) => n.remove())
  const css: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try { css.push(Array.from(sheet.cssRules).map((r) => r.cssText).join('\n')) } catch { /* cross-origin sheet */ }
  }
  const style = document.createElement('style'); style.textContent = '#ae-ai-toggle,#ae-pen,#ae-eraser,#ae-viewer-exit,#ae-viewer-page,.ae-fab{display:none!important}\n' + css.join('\n') + (scale && scale !== 1 ? `\nhtml{zoom:${scale}}` : '') + '\n@page{margin:0}'
  clone.querySelector('head')!.appendChild(style)
  // images
  const liveImgs = Array.from(live.querySelectorAll('img')); const cloneImgs = Array.from(clone.querySelectorAll('img'))
  await Promise.all(liveImgs.map(async (img, i) => {
    const src = img.currentSrc || img.src
    if (!src || src.startsWith('data:')) return
    const d = await toDataUrl(src); if (d) { cloneImgs[i].setAttribute('src', d); cloneImgs[i].removeAttribute('srcset') }
  }))
  // canvases
  const liveCv = Array.from(live.querySelectorAll('canvas')); const cloneCv = Array.from(clone.querySelectorAll('canvas'))
  liveCv.forEach((cv, i) => {
    try { const img = document.createElement('img'); img.src = cv.toDataURL('image/png'); img.setAttribute('style', cv.getAttribute('style') || ''); img.className = cv.className; img.width = cv.clientWidth || cv.width; img.height = cv.clientHeight || cv.height; cloneCv[i].replaceWith(img) } catch {}
  })
  // live form state / inline background urls with blob: are not carried (rare in print layouts)
  return '<!doctype html>' + clone.outerHTML
}

export interface PrintOpts { pageSize?: { width: number; height: number } | string; landscape?: boolean; scale?: number }
const PAPER: Record<string, [number, number]> = { A3: [11.69, 16.54], A4: [8.27, 11.69], A5: [5.83, 8.27], Letter: [8.5, 11], Legal: [8.5, 14], Tabloid: [11, 17] }
export function pageInches(o: PrintOpts): [number, number] {
  let [w, h] = typeof o.pageSize === 'string' ? (PAPER[o.pageSize] ?? PAPER.A4) : o.pageSize ? [o.pageSize.width, o.pageSize.height] : PAPER.A4
  if (o.landscape && w < h) [w, h] = [h, w]
  return [w, h]
}

/** dev/test hook: window.__aePdfHook(html, widthPt, heightPt) -> base64 (lets a desktop browser stand in for the native renderer) */
export async function htmlToPdf(html: string, o: PrintOpts): Promise<Uint8Array> {
  const [w, h] = pageInches(o)
  const hook = (globalThis as any).__aePdfHook
  if (hook) { const b64: string = await hook(html, w * 72, h * 72); const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u }
  if (!isNative()) throw new Error('PDF 내보내기는 iOS 앱에서만 지원됩니다.')
  return renderPdfNative(html, w * 72, h * 72)
}

export async function printCurrentDocument(o: PrintOpts) {
  return htmlToPdf(await snapshotDocument(o.scale ?? 1), o)
}


// ------------------------------------------------------------------ printers
export interface PrinterCfg { id: string; name: string; host: string; protocol: 'auto' | 'ipp' | 'raw'; port?: number }
const SKEY = 'alleditor.settings'
export function getPrinters(): PrinterCfg[] {
  try { const v = JSON.parse(localStorage.getItem(SKEY) || '{}').printers; return Array.isArray(v) ? v : [] } catch { return [] }
}
export function setPrinters(list: PrinterCfg[]) {
  let s: Record<string, any> = {}; try { s = JSON.parse(localStorage.getItem(SKEY) || '{}') } catch {}
  s.printers = list; localStorage.setItem(SKEY, JSON.stringify(s))
  void backupPrinters(list)
}

// The printer list also lives in the iCloud AllEditor folder (hidden: .alleditor/printers.json), so it comes back
// after the app is deleted and installed again, and on the user's other devices.
const PRINTERS_FILE = '.alleditor/printers.json'
const b64 = (t: string) => { const u = new TextEncoder().encode(t); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s) }
const unb64 = (d: string) => { const bin = atob(d); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u) }
async function backupPrinters(list: PrinterCfg[]) {
  if (!isNative()) return
  try { await Filesystem.writeFile({ path: PRINTERS_FILE, directory: Directory.Documents, data: b64(JSON.stringify({ version: 1, printers: list }, null, 2)) }) }
  catch (e) { console.warn('[printers] backup', e) }
}
/** a fresh install (no printer list on this device yet): take the one saved in the AllEditor folder */
export async function restorePrinters(): Promise<boolean> {
  if (!isNative()) return false
  let s: Record<string, any> = {}; try { s = JSON.parse(localStorage.getItem(SKEY) || '{}') } catch {}
  if (Array.isArray(s.printers)) { if (s.printers.length) void backupPrinters(s.printers); return false }
  try {
    const { data } = await Filesystem.readFile({ path: PRINTERS_FILE, directory: Directory.Documents })
    const saved = JSON.parse(unb64(data))?.printers
    if (!Array.isArray(saved)) return false
    const ok = saved.filter((p: any) => p && typeof p.id === 'string' && typeof p.host === 'string' && /^[\w.\-:]+$/.test(p.host))
      .map((p: any) => ({ id: p.id, name: String(p.name ?? p.host), host: p.host, protocol: ['auto', 'ipp', 'raw'].includes(p.protocol) ? p.protocol : 'auto', ...(Number.isInteger(p.port) ? { port: p.port } : {}) }))
    s.printers = ok; localStorage.setItem(SKEY, JSON.stringify(s))
    return ok.length > 0
  } catch { return false }
}
/** what the apps' print dialogs list (Electron's getPrintersAsync shape) */
export const printerChoices = () => getPrinters().map((p) => ({ name: 'ip:' + p.id, displayName: `${p.name} (${p.host})`, isDefault: false }))

export interface PrintJob { deviceName?: string; copies?: number; duplexMode?: 'simplex' | 'longEdge' | 'shortEdge' }

/** Electron print() options -> page size in inches */
export function pageInchesFromElectron(o: any): [number, number] {
  if (o?.pageSizeIn?.width) return [o.pageSizeIn.width, o.pageSizeIn.height]
  const ps = o?.pageSize
  if (ps && typeof ps === 'object' && ps.width > 1000) return [ps.width / 25400, ps.height / 25400] // microns
  return pageInches({ pageSize: ps, landscape: o?.landscape })
}

/** hand a finished PDF to the chosen printer: a configured IP printer, else the iOS print dialog */
export async function sendToPrinter(pdf: Uint8Array, job: PrintJob = {}, jobName = 'AllEditor'): Promise<boolean> {
  const cfg = job.deviceName?.startsWith('ip:') ? getPrinters().find((p) => 'ip:' + p.id === job.deviceName) : undefined
  if (job.deviceName?.startsWith('ip:') && !cfg) throw new Error('프린터 설정을 찾을 수 없습니다. 설정 › 프린터를 확인하세요.')
  const hook = (globalThis as any).__aePrintHook
  if (hook) { await hook({ pdf, job, cfg }); return true } // dev/test hook
  if (!isNative()) throw new Error('인쇄는 iOS 앱에서만 지원됩니다.')
  if (cfg) {
    const sides = job.duplexMode === 'longEdge' ? 'two-sided-long-edge' : job.duplexMode === 'shortEdge' ? 'two-sided-short-edge' : undefined
    await nativeDirectPrint({ host: cfg.host, port: cfg.port, protocol: cfg.protocol, pdf, jobName, copies: job.copies, sides })
    return true
  }
  const r = await nativePrintDialog(pdf, jobName)
  return r.completed
}

/** one-page test PDF (Helvetica text) for the Settings › Printer test button */
export function testPdf(line: string): Uint8Array {
  const text = line.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '')
  const stream = `BT /F1 20 Tf 72 740 Td (AllEditor - Test Page) Tj 0 -32 Td /F1 12 Tf (${text}) Tj 0 -20 Td (Developed by JaiSung NOH MD 2026) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'; const off: number[] = []
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

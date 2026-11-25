// printToPDF for the in-page "Electron": snapshot the live document (or a fake hidden window's HTML)
// into a self-contained HTML string and let the native side paginate it with @media print rules.
import { renderPdfNative } from './native-files'

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
  clone.querySelectorAll('#ae-home, #ae-file').forEach((n) => n.remove())
  clone.querySelectorAll('script, link[rel=preload], link[rel=modulepreload], iframe, video, audio').forEach((n) => n.remove())
  // styles: replace <link rel=stylesheet> and <style> by the cssText of the live sheets (keeps @media print)
  clone.querySelectorAll('link[rel=stylesheet], style').forEach((n) => n.remove())
  const css: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try { css.push(Array.from(sheet.cssRules).map((r) => r.cssText).join('\n')) } catch { /* cross-origin sheet */ }
  }
  const style = document.createElement('style'); style.textContent = css.join('\n') + (scale && scale !== 1 ? `\nhtml{zoom:${scale}}` : '') + '\n@page{margin:0}'
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
  if (!(globalThis as any).Capacitor?.isNativePlatform?.()) throw new Error('PDF 내보내기는 iOS 앱에서만 지원됩니다.')
  return renderPdfNative(html, w * 72, h * 72)
}

export async function printCurrentDocument(o: PrintOpts) {
  return htmlToPdf(await snapshotDocument(o.scale ?? 1), o)
}

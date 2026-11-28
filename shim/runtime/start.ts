import fs, { hydrate, flush, loadOpenedDocument } from './fs'
import { markReady, webContents } from './electron'
import { registerShellIpc, syncAiFromNative } from './shell-ipc'
import { applyPhoneLayer, isPhone } from './phone'
import { installAiToggle } from './ai-toggle'
import { installBundledFonts } from './fonts'
import { installPdfPencil } from './pdf-pencil'
import { installPinchZoom } from './pinch'
import { installViewer } from './viewer'
import { installHwpPrintDialog } from './hwp-print'
import { setUiLang } from '@genoffice/i18n'
import { USER_ROOT } from './fs'
import { typedPath } from './folders'

export function start(app: string, register: (open: string | null) => void, preload: Array<[string, string]> = []) {
  // a document picked from outside AllEditor is a copy (home: ?import=1); a .hwp copy is first saved as .hwpx
  {
    const q = new URLSearchParams(location.search), imp = q.get('import') === '1' ? q.get('open') : null
    // '' stops the save: an autosave leaves the copy alone, and a Save asks for the .hwpx name (취소 stops it)
    ;(globalThis as any).__aeImportTarget = (p: string, automatic = false): string | null => {
      if (!imp || !/\.hwp$/i.test(p) || p.normalize('NFC') !== imp.normalize('NFC')) return null
      if (automatic) return ''
      const stem = p.slice(p.lastIndexOf('/') + 1).replace(/\.hwp$/i, '')
      const ko = (() => { try { return (JSON.parse(localStorage.getItem('alleditor.settings') || '{}').language ?? 'ko') === 'ko' } catch { return true } })()
      const got = prompt(ko ? 'HWPX 형식으로 저장합니다. 파일 이름을 확인하세요.\n(가져온 .hwp 사본은 저장 후 지워집니다)' : 'Saving as HWPX. Check the file name.\n(The imported .hwp copy is removed after saving)', stem)
      if (got == null) return ''
      const name = got.trim().replace(/\.hwpx?$/i, '').replace(/[\\/:*?"<>|]/g, '_') || stem
      return typedPath(name + '.hwpx')
    }
  }
  applyPhoneLayer()
  if (app === 'sheets') addSheetsMenu()
  ;(window as any).__aeFlush = flush
  addHomeButton()
  installAiToggle()
  installBundledFonts(app)
  // WebKit (iPad, and the iPad app on a Mac) enlarges small text in wide blocks by itself ("text autosizing"). The
  // print preview shows a page shrunk with CSS zoom, so its text came out larger than printed and the lines broke
  // differently. Text keeps the size the document gives it, everywhere.
  { const st = document.createElement('style'); st.textContent = 'html,body,*{-webkit-text-size-adjust:100%!important;text-size-adjust:100%!important}'; (document.head ?? document.documentElement).appendChild(st) }
  // the keyboard must not scroll the page (the editors scroll inside their own panes)
  addEventListener('scroll', () => { if (scrollY || scrollX) scrollTo(0, 0) }, { passive: true })
  // the editors' own main-process code (dialogs, untitled names) speaks the app's language (Korean unless English is chosen)
  try { setUiLang((JSON.parse(localStorage.getItem('alleditor.settings') || '{}').language ?? 'ko') === 'en' ? 'en' : 'ko') } catch { setUiLang('ko') }
  if (app === 'pdf') installPdfPencil()
  if (app === 'hwp') installHwpPrintDialog()
  installPinchZoom() // two fingers zoom the document, not the app
  installViewer(app) // 전체보기
  ;(async () => {
    try { await hydrate() } catch (e) { console.warn('[hydrate]', e) }
    { const o = new URLSearchParams(location.search).get('open'); if (o) await loadOpenedDocument(o) }
    if (app === 'hwp') try {
      const f = `${USER_ROOT}/app-settings.json`
      const cur = fs.existsSync(f) ? JSON.parse(String(fs.readFileSync(f, 'utf8'))) : {}
      if (!cur.hwpDefaultFormat) { cur.hwpDefaultFormat = 'hwpx'; fs.writeFileSync(f, JSON.stringify(cur, null, 2)) }
    } catch {}
    const base = (document.currentScript as HTMLScriptElement | null)?.src || location.href
    await Promise.all(preload.map(async ([dest, url]) => {
      try {
        const r = await (globalThis as any).__realFetch(new URL(url, base).href)
        fs.mkdirSync(dest.slice(0, dest.lastIndexOf('/')), { recursive: true })
        fs.writeFileSync(dest, new Uint8Array(await r.arrayBuffer()))
      } catch (e) { console.warn('[preload]', url, e) }
    }))
    try { await syncAiFromNative() } catch (e) { console.warn('[ai sync]', e) }
    try { register(new URLSearchParams(location.search).get('open')); registerShellIpc() /* after the apps: shell-level settings (language…) must win */ } catch (e) { console.error(`[${app}] register failed`, e) }
    markReady()
  })()
}

/** floating "home" button so every app can return to the launcher */
export function addHomeButton() {
  const add = () => {
    if (window.parent !== window) return // inside a tab: the shell's tab bar is the way back
    if (document.getElementById('ae-home')) return
    const b = document.createElement('button')
    b.id = 'ae-home'; b.textContent = '\u2302'; b.setAttribute('aria-label', '홈')
    b.style.cssText = 'position:fixed;left:calc(env(safe-area-inset-left,0px) + 8px);bottom:calc(env(safe-area-inset-bottom,0px) + ' + (isPhone() ? '64px' : '40px') + ');z-index:1500;width:40px;height:40px;border-radius:20px;border:1px solid rgba(128,128,128,.4);background:rgba(120,120,128,.55);color:#fff;font-size:22px;line-height:1;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)'
    b.onclick = async () => { try { await flush() } catch {} ; location.href = '../index.html' }
    document.body.appendChild(b)
  }
  if (document.body) add(); else addEventListener('DOMContentLoaded', add)
}

/** Sheets keeps its File commands in the native desktop menu; give iOS a small floating menu that sends the same actions. */
function addSheetsMenu() {
  const ko = (() => { try { return (JSON.parse(localStorage.getItem('alleditor.settings') || '{}').language ?? 'ko') === 'ko' } catch { return true } })()
  const items: Array<[string, string, string]> = [
    ['open', '열기…', 'Open…'], ['save', '저장', 'Save'], ['save-as', '다른 이름으로 저장…', 'Save as…'],
    ['export-pdf', 'PDF로 내보내기…', 'Export as PDF…'], ['export-csv', 'CSV로 내보내기…', 'Export as CSV…'],
  ]
  const add = () => {
    if (document.getElementById('ae-file')) return
    const btn = document.createElement('button')
    btn.id = 'ae-file'; btn.textContent = '\u22EF'; btn.setAttribute('aria-label', ko ? '파일 메뉴' : 'File menu')
    const phone = isPhone()
    btn.style.cssText = 'position:fixed;right:calc(env(safe-area-inset-right,0px) + 12px);bottom:calc(env(safe-area-inset-bottom,0px) + ' + (phone ? '112px' : '88px') + ');z-index:1500;width:40px;height:40px;border-radius:20px;border:1px solid rgba(128,128,128,.4);background:rgba(120,120,128,.55);color:#fff;font-size:22px;line-height:1;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)'
    const menu = document.createElement('div')
    menu.style.cssText = 'position:fixed;right:calc(env(safe-area-inset-right,0px) + 60px);bottom:calc(env(safe-area-inset-bottom,0px) + ' + (phone ? '112px' : '88px') + ');z-index:1600;background:#fff;color:#111;border-radius:12px;box-shadow:0 6px 28px rgba(0,0,0,.28);padding:6px 0;display:none;min-width:200px;font:16px -apple-system,system-ui,sans-serif'
    for (const [action, k, e] of items) {
      const it = document.createElement('button'); it.textContent = ko ? k : e
      it.style.cssText = 'display:block;width:100%;text-align:left;padding:12px 18px;border:0;background:none;color:inherit;font:inherit'
      it.onclick = () => { menu.style.display = 'none'; webContents.send('menu:action', action) }
      menu.appendChild(it)
    }
    btn.onclick = (ev) => { ev.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none' }
    document.addEventListener('click', () => { menu.style.display = 'none' })
    document.body.append(btn, menu)
  }
  if (document.body) add(); else addEventListener('DOMContentLoaded', add)
}

import fs, { hydrate, flush } from './fs'
import { markReady, webContents } from './electron'
import { registerShellIpc } from './shell-ipc'
import { applyPhoneLayer, isPhone } from './phone'
import { installAiToggle } from './ai-toggle'

export function start(app: string, register: (open: string | null) => void, preload: Array<[string, string]> = []) {
  applyPhoneLayer()
  if (app === 'sheets') addSheetsMenu()
  ;(window as any).__aeFlush = flush
  addHomeButton()
  installAiToggle()
  ;(async () => {
    try { await hydrate() } catch (e) { console.warn('[hydrate]', e) }
    const base = (document.currentScript as HTMLScriptElement | null)?.src || location.href
    await Promise.all(preload.map(async ([dest, url]) => {
      try {
        const r = await (globalThis as any).__realFetch(new URL(url, base).href)
        fs.mkdirSync(dest.slice(0, dest.lastIndexOf('/')), { recursive: true })
        fs.writeFileSync(dest, new Uint8Array(await r.arrayBuffer()))
      } catch (e) { console.warn('[preload]', url, e) }
    }))
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

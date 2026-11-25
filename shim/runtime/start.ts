import fs, { hydrate, flush } from './fs'
import { markReady } from './electron'
import { registerShellIpc } from './shell-ipc'
import { applyPhoneLayer, isPhone } from './phone'

export function start(app: string, register: (open: string | null) => void, preload: Array<[string, string]> = []) {
  applyPhoneLayer()
  addHomeButton()
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
    try { registerShellIpc(); register(new URLSearchParams(location.search).get('open')) } catch (e) { console.error(`[${app}] register failed`, e) }
    markReady()
  })()
}

/** floating "home" button so every app can return to the launcher */
export function addHomeButton() {
  const add = () => {
    if (document.getElementById('ae-home')) return
    const b = document.createElement('button')
    b.id = 'ae-home'; b.textContent = '\u2302'; b.setAttribute('aria-label', 'Home')
    b.style.cssText = 'position:fixed;left:calc(env(safe-area-inset-left,0px) + 8px);bottom:calc(env(safe-area-inset-bottom,0px) + ' + (isPhone() ? '64px' : '40px') + ');z-index:1500;width:40px;height:40px;border-radius:20px;border:1px solid rgba(128,128,128,.4);background:rgba(120,120,128,.55);color:#fff;font-size:22px;line-height:1;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)'
    b.onclick = async () => { try { await flush() } catch {} ; location.href = '../index.html' }
    document.body.appendChild(b)
  }
  if (document.body) add(); else addEventListener('DOMContentLoaded', add)
}

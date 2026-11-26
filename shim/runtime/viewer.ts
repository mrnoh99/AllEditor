// 전체보기 — a viewer: the document alone, as large as the screen allows, page by page, no editing chrome.
// The office home's 전체보기 button asks the open tab (postMessage 'ae-viewer'); the tab bar hides meanwhile.
//  - Word, PDF: the editors' own presentation view (F5 / Ctrl+F5: page fit, read-only, page by page)
//  - PowerPoint: its slide show from the current slide (Shift+F5)
//  - Excel, 한글: the ribbons, bars and panels are hidden; the sheet / pages fill the screen
// A swipe left / right turns the page (keys the views understand, or one screen of scroll), ✕ leaves.
// Portrait and landscape both work (the iPad is not locked to landscape any more).

const ko = () => { try { return (JSON.parse(localStorage.getItem('alleditor.settings') || '{}').language ?? 'ko') !== 'en' } catch { return true } }
const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => {
  const init: KeyboardEventInit = { key: k, code: k, bubbles: true, cancelable: true, composed: true, ...mods }
  // one event, bubbling from the focused element to the window, where the editors listen
  ;(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', init))
}

const CSS = `
html.ae-viewer #ae-pen,html.ae-viewer #ae-eraser,html.ae-viewer #ae-ai-toggle,html.ae-viewer .ae-home-btn,html.ae-viewer .ae-fab{display:none!important}
#ae-viewer-exit{position:fixed;z-index:2147483000;top:calc(env(safe-area-inset-top,0px) + 10px);right:calc(env(safe-area-inset-right,0px) + 12px);
  width:40px;height:40px;border-radius:20px;border:0;background:rgba(0,0,0,.45);color:#fff;font:600 18px/40px -apple-system,system-ui,sans-serif;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;padding:0}
html.ae-viewer #ae-viewer-exit{display:block}
#ae-viewer-page{position:fixed;z-index:2147483000;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);left:50%;transform:translateX(-50%);
  padding:4px 12px;border-radius:12px;background:rgba(0,0,0,.45);color:#fff;font:500 13px -apple-system,system-ui,sans-serif;display:none;pointer-events:none}
html.ae-viewer #ae-viewer-page{display:block}
/* Excel: the grid alone */
html.ae-viewer.ae-app-sheets header.excel-header,html.ae-viewer.ae-app-sheets aside.copilot,
html.ae-viewer.ae-app-sheets footer.status-bar,html.ae-viewer.ae-app-sheets .ai-dock{display:none!important}
html.ae-viewer.ae-app-sheets .sheet-body{grid-template-columns:minmax(0,1fr)!important}
html.ae-viewer.ae-app-sheets main.app-shell{grid-template-rows:minmax(0,1fr)!important}
/* 한글: the host page's AI panel and bars (the studio inside hides its own, see ribbon.mjs) */
html.ae-viewer.ae-app-hwp .ai-dock,html.ae-viewer.ae-app-hwp aside.copilot,html.ae-viewer.ae-app-hwp .hwp-topbar,
html.ae-viewer.ae-app-hwp [class*="toolbar"]:not(iframe){display:none!important}
`

/** the biggest vertically scrolling element: where a page turn scrolls when the view has no page keys */
function mainScroller(root: Document = document): HTMLElement | null {
  let best: HTMLElement | null = null, area = 0
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (el.scrollHeight <= el.clientHeight + 20) continue
    const st = getComputedStyle(el)
    if (!/(auto|scroll)/.test(st.overflowY)) continue
    const a = el.clientWidth * el.clientHeight
    if (a > area) { area = a; best = el }
  }
  return best
}
const studioDoc = (): Document | null => {
  const f = document.querySelector<HTMLIFrameElement>('iframe[src*="studio"]')
  try { return f?.contentDocument ?? null } catch { return null }
}

export function installViewer(app: string) {
  let on = false
  const style = document.createElement('style'); style.textContent = CSS
  const exitBtn = document.createElement('button'); exitBtn.id = 'ae-viewer-exit'; exitBtn.type = 'button'; exitBtn.textContent = '✕'
  const pageTag = document.createElement('div'); pageTag.id = 'ae-viewer-page'
  const mount = () => { document.head.appendChild(style); document.body.append(exitBtn, pageTag); document.documentElement.classList.add(`ae-app-${app}`) }
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount)

  const turn = (dir: 1 | -1) => {
    if (!on) return
    if (app === 'docs' || app === 'pdf' || app === 'slides') { key(dir > 0 ? 'PageDown' : 'PageUp'); key(dir > 0 ? 'ArrowRight' : 'ArrowLeft') }
    const doc = app === 'hwp' ? studioDoc() ?? document : document
    if (app !== 'slides') {
      const sc = mainScroller(doc)
      if (sc) sc.scrollBy({ top: dir * sc.clientHeight * 0.92, behavior: 'smooth' })
    }
  }

  const enter = () => {
    if (on) return
    on = true
    document.documentElement.classList.add('ae-viewer')
    exitBtn.setAttribute('aria-label', ko() ? '전체보기 닫기' : 'Close full view')
    if (app === 'docs') key('F5')
    else if (app === 'pdf') key('F5', { ctrlKey: true })
    else if (app === 'slides') key('F5', { shiftKey: true })
    else if (app === 'hwp') studioDoc()?.defaultView?.postMessage({ type: 'ae-viewer', on: true }, '*')
    for (const ms of [120, 400, 900]) setTimeout(() => window.dispatchEvent(new Event('resize')), ms)
  }
  const exit = (tellHome = true) => {
    if (!on) return
    on = false
    document.documentElement.classList.remove('ae-viewer')
    if (app === 'docs' || app === 'pdf' || app === 'slides') key('Escape')
    if (app === 'hwp') studioDoc()?.defaultView?.postMessage({ type: 'ae-viewer', on: false }, '*')
    if (tellHome) try { window.parent.postMessage({ type: 'ae-viewer-exit' }, '*') } catch {}
    setTimeout(() => window.dispatchEvent(new Event('resize')), 120)
  }
  exitBtn.onclick = () => exit()

  addEventListener('message', (e) => {
    const d = e.data as { type?: string; on?: boolean } | null
    if (d?.type === 'ae-viewer') { if (d.on) enter(); else exit(false) }
  })
  // the editors' own Esc (leaving the show) ends the viewer too
  addEventListener('keydown', (e) => { if (on && e.key === 'Escape' && e.isTrusted) exit() }, true)

  // swipe left / right: next / previous page
  let sx = 0, sy = 0, st = 0, track = false
  const down = (e: TouchEvent) => { if (!on || e.touches.length !== 1) { track = false; return } track = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = e.timeStamp }
  const up = (e: TouchEvent) => {
    if (!on || !track) return
    track = false
    const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && e.timeStamp - st < 800) turn(dx < 0 ? 1 : -1)
  }
  document.addEventListener('touchstart', down, { capture: true, passive: true })
  document.addEventListener('touchend', up, { capture: true, passive: true })
  // 한글: the studio frame gets the same swipes
  const hookStudio = () => {
    const d = studioDoc()
    if (!d || (d as any).__aeViewerSwipe) return
    ;(d as any).__aeViewerSwipe = true
    d.addEventListener('touchstart', down, { capture: true, passive: true })
    d.addEventListener('touchend', up, { capture: true, passive: true })
  }
  if (app === 'hwp') setInterval(hookStudio, 2000)
}

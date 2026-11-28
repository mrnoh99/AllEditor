// AI panel handle: a clearly visible "AI" tab on the edge of the AI panel that folds / unfolds it
// (Docs / Slides / Sheets / PDF). It drives the apps' own controls — the panel's collapse button
// (.ai-panel-collapse) and the ribbon's main AI button (first .ai-entry) — and remembers the choice:
// a folded panel stays folded in every document until it is unfolded again.

const KEY = 'alleditor.settings'
const readFolded = (): boolean => { try { return JSON.parse(localStorage.getItem(KEY) || '{}').aiFolded === true } catch { return false } }
const writeFolded = (v: boolean) => {
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); s.aiFolded = v; localStorage.setItem(KEY, JSON.stringify(s)) } catch {}
}
/** the app's theme (설정 › 테마), not only the system's: a light app on a dark iPad keeps a light handle */
const appDark = () => {
  let th = 'system'
  try { th = JSON.parse(localStorage.getItem(KEY) || '{}').theme ?? 'system' } catch {}
  return th === 'dark' || (th !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
}
const ko = () => { try { return (JSON.parse(localStorage.getItem(KEY) || '{}').language ?? 'ko') !== 'en' } catch { return true } }

const dock = () => document.querySelector<HTMLElement>('.ai-dock, aside.copilot')
const isOpen = (d: HTMLElement | null) => !!d && !d.classList.contains('collapsed') && d.getBoundingClientRect().width > 40
const collapseBtn = () => dock()?.querySelector<HTMLButtonElement>('.ai-panel-collapse') ?? null
const openBtn = () => document.querySelector<HTMLButtonElement>('button.ai-entry')

const CSS = `
#ae-ai-toggle{position:fixed;z-index:1400;top:50%;transform:translateY(-50%);width:26px;height:64px;padding:0;
  border:1px solid rgba(128,128,128,.35);background:var(--surface,#fff);color:var(--text,#333);
  font:600 11px/1.15 -apple-system,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  box-shadow:0 2px 10px rgba(0,0,0,.14);cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
#ae-ai-toggle.left{border-radius:0 12px 12px 0;border-left:0}
#ae-ai-toggle.right{border-radius:12px 0 0 12px;border-right:0}
#ae-ai-toggle .chev{font-size:15px;line-height:1}
#ae-ai-toggle.dark{background:#2c2c2e;color:#eee}
@media print{#ae-ai-toggle{display:none!important}}
`
/** a dialog (print, export, settings) over the editor: the handle would sit on top of it */
const dialogOpen = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog[open], .modal-backdrop, .print-dialog, .modal, .pdf-modal, .pdf-modal-mask, [class*="modal-mask"], [class*="dialog-backdrop"]')]
  .some((e) => { const r = e.getBoundingClientRect(); return r.width > 200 && r.height > 150 && getComputedStyle(e).visibility !== 'hidden' })

export function installAiToggle() {
  const start = () => {
    if (document.getElementById('ae-ai-toggle')) return
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style)
    const b = document.createElement('button')
    b.id = 'ae-ai-toggle'; b.type = 'button'; b.hidden = true
    document.body.appendChild(b)
    let applied = false

    const place = () => {
      const d = dock()
      if (!d || (!openBtn() && !collapseBtn()) || dialogOpen() || document.documentElement.classList.contains('ae-viewer')) { b.hidden = true; return }
      b.hidden = false
      const open = isOpen(d)
      const r = d.getBoundingClientRect()
      // panel on the left (default) or moved to the right by the user
      const right = open ? r.left > window.innerWidth / 2 : d.classList.contains('ai-dock-right') || getComputedStyle(d).order === '2'
      b.className = (right ? 'right' : 'left') + (appDark() ? ' dark' : '')
      const top = open ? r.top + r.height / 2 : window.innerHeight / 2
      b.style.top = `${Math.round(top)}px`
      if (right) { b.style.left = ''; b.style.right = `${Math.round(open ? window.innerWidth - r.left : 0)}px` }
      else { b.style.right = ''; b.style.left = `${Math.round(open ? r.right : 0)}px` }
      const chev = open ? (right ? '›' : '‹') : (right ? '‹' : '›')
      b.innerHTML = `<span>AI</span><span class="chev">${chev}</span>`
      b.setAttribute('aria-label', open ? (ko() ? 'AI 패널 접기' : 'Fold the AI panel') : (ko() ? 'AI 패널 펼치기' : 'Unfold the AI panel'))
      b.setAttribute('aria-expanded', String(open))
      // remembered choice: fold once the app has rendered its panel
      if (!applied && open && readFolded()) { applied = true; collapseBtn()?.click() }
      else if (!applied) applied = true
    }

    b.onclick = () => {
      const open = isOpen(dock())
      if (open) { collapseBtn()?.click(); writeFolded(true) }
      else { openBtn()?.click(); writeFolded(false) }
      setTimeout(place, 50); setTimeout(place, 260)
    }

    let raf = 0
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place) }
    new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] })
    addEventListener('resize', schedule)
    addEventListener('storage', schedule)
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', schedule)
    document.addEventListener('transitionend', schedule, true)
    schedule()
  }
  if (document.body) start(); else addEventListener('DOMContentLoaded', start)
}

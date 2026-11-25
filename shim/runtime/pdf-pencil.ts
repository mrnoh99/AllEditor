// PDF + Apple Pencil (iPad). The PDF editor already has a freehand ink tool (주석 › 자유 그리기) whose strokes are
// saved into the PDF as ink annotations. This layer makes it work the iPad way:
//  - a pen button floats on the page: one tap arms / disarms the ink tool (it opens the 주석 tab when needed)
//  - Apple Pencil draws, a finger scrolls and zooms (once a Pencil has been used; before that a finger draws too)
//  - the palm or a finger resting on the screen while writing never adds a stroke
//  - touching a page with the Pencil while no tool is armed arms the ink tool (like Notes / Files markup)
// iOS reports a Pencil touch as Touch.touchType === 'stylus' and a pointer event as pointerType 'pen'.

const KO = () => { try { return (JSON.parse(localStorage.getItem('alleditor.settings') || '{}').language ?? 'ko') !== 'en' } catch { return true } }
const INK_TIPS = ['자유 그리기', 'Draw']
const ANNOTATE_TABS = ['주석', 'Annotate']

const inkButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button.rb-big')].find((b) => INK_TIPS.includes(b.dataset.tip ?? '') || INK_TIPS.includes(b.textContent?.trim() ?? '')) ?? null
const annotateTab = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button.ribbon-tab')].find((b) => ANNOTATE_TABS.includes(b.textContent?.trim() ?? '')) ?? null
const inkArmed = () => !!inkButton()?.classList.contains('active')
const drawLayer = (t: EventTarget | null) => (t instanceof Element ? t.closest('.pdf-draw-active') : null)
const onPage = (t: EventTarget | null) => (t instanceof Element ? !!t.closest('.pdf-scroll') && !t.closest('button, input, textarea, [contenteditable=true]') : false)

/** arm or disarm the ink tool through the editor's own ribbon button */
function setInk(on: boolean) {
  if (inkArmed() === on) return
  const click = () => { const b = inkButton(); if (b && !b.disabled && inkArmed() !== on) b.click() }
  if (inkButton()) { click(); return }
  annotateTab()?.click()
  requestAnimationFrame(() => requestAnimationFrame(click))
}

const CSS = `
#ae-pen{position:fixed;z-index:1500;right:calc(env(safe-area-inset-right,0px) + 12px);top:50%;transform:translateY(-50%);
  width:44px;height:44px;border-radius:22px;border:1px solid rgba(128,128,128,.4);background:rgba(120,120,128,.55);color:#fff;
  display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;padding:0}
#ae-pen.on{background:#0a84ff;border-color:#0a84ff}
html.ae-pencil .pdf-draw-active{touch-action:pan-x pan-y pinch-zoom !important}
`
const PEN_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'

export function installPdfPencil() {
  let pencilSeen = false
  let penPointer: number | null = null

  const start = () => {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style)
    const b = document.createElement('button')
    b.id = 'ae-pen'; b.type = 'button'; b.innerHTML = PEN_SVG; b.hidden = true
    b.onclick = () => setInk(!inkArmed())
    document.body.appendChild(b)
    const sync = () => {
      const hasDoc = !!document.querySelector('.pdf-scroll')
      b.hidden = !hasDoc
      const on = inkArmed()
      b.classList.toggle('on', on)
      const ko = KO()
      b.setAttribute('aria-label', on ? (ko ? '펜 끄기' : 'Pen off') : (ko ? '펜으로 쓰기' : 'Write with the pen'))
      b.setAttribute('aria-pressed', String(on))
    }
    let raf = 0
    new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sync) })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    sync()
  }
  if (document.body) start(); else addEventListener('DOMContentLoaded', start)

  // Pencil on the page: no scrolling under the pen; arm the ink tool when nothing is armed
  document.addEventListener('touchstart', (e) => {
    const stylus = [...e.changedTouches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')
    if (stylus) {
      if (!pencilSeen) { pencilSeen = true; document.documentElement.classList.add('ae-pencil') }
      if (drawLayer(e.target)) e.preventDefault()
      else if (onPage(e.target) && !document.querySelector('.pdf-draw-active')) setInk(true)
    } else if (!pencilSeen && drawLayer(e.target)) {
      e.preventDefault() // no Pencil yet: a finger draws, so it must not scroll
    }
  }, { capture: true, passive: false })

  // once a Pencil is in use, finger / palm pointers never reach the drawing layer (they scroll instead),
  // and a second pointer never joins a stroke in progress
  const gate = (e: PointerEvent) => {
    if (!drawLayer(e.target)) return
    if (e.pointerType === 'pen') {
      if (e.type === 'pointerdown') penPointer = e.pointerId
      else if ((e.type === 'pointerup' || e.type === 'pointercancel') && e.pointerId === penPointer) penPointer = null
      return
    }
    if (pencilSeen || (penPointer !== null && e.pointerId !== penPointer)) e.stopPropagation()
  }
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) window.addEventListener(type, gate, true)
}

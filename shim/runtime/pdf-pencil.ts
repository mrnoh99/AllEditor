// PDF + Apple Pencil (iPad). The PDF editor already has a freehand ink tool (주석 › 자유 그리기) whose strokes are
// saved into the PDF as ink annotations. This layer makes it work the iPad way:
//  - a pen button floats on the page: one tap arms / disarms the ink tool (it opens the 주석 tab when needed)
//  - Apple Pencil draws, a finger scrolls and zooms (once a Pencil has been used; before that a finger draws too)
//  - the palm or a finger resting on the screen while writing never adds a stroke
//  - touching a page with the Pencil while no tool is armed arms the ink tool (like Notes / Files markup)
//  - an eraser button below the pen: the Pencil or a finger rubbed over strokes deletes them; while writing, a
//    finger tap on a stroke deletes that stroke
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
#ae-pen{position:fixed;z-index:1500;right:calc(env(safe-area-inset-right,0px) + 12px);top:calc(50% - 76px);
  width:44px;height:44px;border-radius:22px;border:1px solid rgba(128,128,128,.4);background:rgba(120,120,128,.55);color:#fff;
  display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;padding:0}
#ae-pen.on{background:#0a84ff;border-color:#0a84ff}
#ae-eraser{position:fixed;z-index:1500;right:calc(env(safe-area-inset-right,0px) + 12px);top:calc(50% + 32px);
  width:44px;height:44px;border-radius:22px;border:1px solid rgba(128,128,128,.4);background:rgba(120,120,128,.55);color:#fff;
  display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;padding:0}
#ae-eraser.on{background:#ff9500;border-color:#ff9500}
html.ae-erasing .pdf-scroll{cursor:cell}
html.ae-erasing .pdf-scroll .textLayer{pointer-events:none}
html.ae-pencil .pdf-draw-active{touch-action:pan-x pan-y pinch-zoom !important}
`
const ERASER_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>'
const PEN_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'


// ---- erasing: a stroke under the eraser (or under a finger tap while writing) is selected and deleted the editor's
// own way (click selects a drawing, Delete removes it — one undo step each, "삭제됨 · 실행 취소" toast)
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
/** the drawing (svg group) whose stroke passes within a few pixels of a screen point */
function strokeAt(x: number, y: number): SVGGElement | null {
  const groups = [...document.querySelectorAll<SVGGElement>('.pdf-draw-layer g.pdf-draw-shape')]
  const offsets = [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [4, 4], [-4, -4], [4, -4], [-4, 4], [9, 0], [-9, 0], [0, 9], [0, -9]]
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    for (const shape of g.querySelectorAll<SVGGeometryElement>('path, polyline, line, rect, ellipse, polygon')) {
      const ctm = shape.getScreenCTM()
      if (!ctm) continue
      const inv = ctm.inverse()
      for (const [dx, dy] of offsets) {
        const pt = new DOMPoint(x + dx, y + dy).matrixTransform(inv)
        try { if (shape.isPointInStroke(pt) || (shape.getAttribute('fill') && shape.getAttribute('fill') !== 'none' && shape.isPointInFill(pt))) return g } catch {}
      }
    }
  }
  return null
}
let erasing = false
/** delete the drawing under (x, y); true when one was removed */
async function eraseAt(x: number, y: number): Promise<boolean> {
  if (erasing) return false
  if (!strokeAt(x, y)) return false
  erasing = true
  try {
    const wasArmed = inkArmed()
    if (wasArmed) { setInk(false); for (let i = 0; i < 30 && document.querySelector('.pdf-draw-active'); i++) await frame() }
    const g = strokeAt(x, y)
    if (g) {
      const opts = { bubbles: true, cancelable: true, composed: true, pointerId: 97, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 }
      g.dispatchEvent(new PointerEvent('pointerdown', opts))
      await frame(); await frame()
      g.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }))
      await frame(); await frame()
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true }))
      await frame()
    }
    if (wasArmed) setInk(true)
    return !!g
  } finally { erasing = false }
}

let eraserOn = false
let eraserButton: HTMLButtonElement | null = null
function setEraser(on: boolean) {
  eraserOn = on
  document.documentElement.classList.toggle('ae-erasing', on)
  if (on && inkArmed()) setInk(false)
  eraserButton?.classList.toggle('on', on)
}

export function installPdfPencil() {
  let pencilSeen = false
  let penPointer: number | null = null

  // eraser on: the Pencil or a finger rubbing over the page deletes every stroke it touches
  let rubbing: number | null = null
  const rub = (e: PointerEvent) => {
    if (!eraserOn) return
    const onPdf = e.target instanceof Element && !!e.target.closest('.pdf-scroll')
    if (e.type === 'pointerdown') {
      if (!onPdf || e.pointerId === 97) return
      rubbing = e.pointerId
    } else if (e.pointerId !== rubbing) return
    if (e.type === 'pointerup' || e.type === 'pointercancel') { rubbing = null; e.stopPropagation(); return }
    e.stopPropagation(); e.preventDefault()
    void eraseAt(e.clientX, e.clientY)
  }
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) window.addEventListener(type, rub, true)
  document.addEventListener('touchmove', (e) => { if (eraserOn && rubbing !== null) e.preventDefault() }, { capture: true, passive: false })

  // writing with the Pencil: a finger tap on a stroke erases it (a finger drag still scrolls)
  let tap: { id: number; x: number; y: number; t: number } | null = null
  const fingerTap = (e: PointerEvent) => {
    if (eraserOn || !pencilSeen || e.pointerType !== 'touch' || !inkArmed()) return
    if (e.type === 'pointerdown') { tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }; return }
    if (!tap || e.pointerId !== tap.id) return
    if (e.type === 'pointerup' && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10 && e.timeStamp - tap.t < 400) void eraseAt(tap.x, tap.y)
    if (e.type !== 'pointermove') tap = null
  }
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) window.addEventListener(type, fingerTap, true)

  const start = () => {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style)
    const b = document.createElement('button')
    b.id = 'ae-pen'; b.type = 'button'; b.innerHTML = PEN_SVG; b.hidden = true
    b.onclick = () => setInk(!inkArmed())
    document.body.appendChild(b)
    const er = document.createElement('button')
    er.id = 'ae-eraser'; er.type = 'button'; er.innerHTML = ERASER_SVG; er.hidden = true
    er.onclick = () => setEraser(!eraserOn)
    document.body.appendChild(er)
    eraserButton = er
    const sync = () => {
      const hasDoc = !!document.querySelector('.pdf-scroll')
      b.hidden = !hasDoc
      const on = inkArmed()
      b.classList.toggle('on', on)
      const ko = KO()
      b.setAttribute('aria-label', on ? (ko ? '펜 끄기' : 'Pen off') : (ko ? '펜으로 쓰기' : 'Write with the pen'))
      b.setAttribute('aria-pressed', String(on))
      er.hidden = !hasDoc
      if (on && eraserOn && !erasing) setEraser(false) // arming the pen ends the eraser
      er.classList.toggle('on', eraserOn)
      er.setAttribute('aria-label', eraserOn ? (ko ? '지우개 끄기' : 'Eraser off') : (ko ? '지우개 (선을 문질러 지우기)' : 'Eraser (rub out strokes)'))
      er.setAttribute('aria-pressed', String(eraserOn))
    }
    let raf = 0
    new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sync) })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    sync()
  }
  if (document.body) start(); else addEventListener('DOMContentLoaded', start)

  // Pencil on the page: no scrolling under the pen
  document.addEventListener('touchstart', (e) => {
    const stylus = [...e.changedTouches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')
    if (stylus) {
      if (!pencilSeen) { pencilSeen = true; document.documentElement.classList.add('ae-pencil') }
      if (drawLayer(e.target) || onPage(e.target)) e.preventDefault()
    } else if (!pencilSeen && drawLayer(e.target)) {
      e.preventDefault() // no Pencil yet: a finger draws, so it must not scroll
    }
  }, { capture: true, passive: false })

  // the Pencil touching a page while no tool is armed arms the ink tool, and the stroke it started is kept: its
  // points wait until the drawing layer is on screen, then go to it (the rest of the stroke reaches it directly)
  let pending: { id: number; points: PointerEvent[]; up: PointerEvent | null } | null = null
  const replay = (layer: Element, ev: PointerEvent, type: string) =>
    layer.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: ev.pointerId, pointerType: 'pen', isPrimary: true,
      clientX: ev.clientX, clientY: ev.clientY, screenX: ev.screenX, screenY: ev.screenY, pressure: ev.pressure || 0.5,
      button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1,
    }))
  const flushPending = (tries = 0) => {
    if (!pending) return
    const layer = document.querySelector('.pdf-draw-active')
    if (!layer) { if (tries < 60) requestAnimationFrame(() => flushPending(tries + 1)); else pending = null; return }
    const p = pending
    pending = null
    replay(layer, p.points[0], 'pointerdown')
    for (const ev of p.points.slice(1)) replay(layer, ev, 'pointermove')
    if (p.up) replay(layer, p.up, 'pointerup')
  }
  const autoArm = (e: PointerEvent) => {
    if (e.pointerType !== 'pen') return
    if (pending && e.pointerId === pending.id) {
      e.stopPropagation()
      if (e.type === 'pointermove') pending.points.push(e)
      else if (e.type === 'pointerup' || e.type === 'pointercancel') pending.up = e
      return
    }
    if (eraserOn || e.type !== 'pointerdown' || drawLayer(e.target) || !onPage(e.target) || document.querySelector('.pdf-draw-active')) return
    e.stopPropagation(); e.preventDefault()
    pending = { id: e.pointerId, points: [e], up: null }
    setInk(true)
    requestAnimationFrame(() => flushPending())
  }
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) window.addEventListener(type, autoArm, true)
  // a replayed stroke may ask to capture a pointer that has already lifted: that is not an error here
  const capture = Element.prototype.setPointerCapture
  Element.prototype.setPointerCapture = function (id: number) { try { capture.call(this, id) } catch {} }

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

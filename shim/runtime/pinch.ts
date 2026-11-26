// Two-finger pinch on the iPad zooms the document only, around the point between the fingers; the menus keep
// their size. Every editor already zooms its document on Ctrl+wheel anchored at the pointer (the way a desktop
// trackpad pinch arrives: ctrlKey wheel events, deltaY = -100·ln(scale) per frame), so the pinch is handed over
// as exactly that, at the midpoint of the two fingers. The web view's own page zoom is switched off natively
// (AllEditorDialogs.swift aeLockWebViewScroll) and here (gesture events), so the whole app never scales.
// The 한글 editor runs in its own frame and has the same code (apps/hwp/studio-plugin/ribbon.mjs installPinchZoom).

export function installPinchZoom(doc: Document = document) {
  let last: number | null = null
  const seen = new WeakSet<Event>()
  const span = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  const onMove = (e: TouchEvent) => {
    if (seen.has(e)) return
    seen.add(e)
    if (e.touches.length !== 2 || last === null) return
    e.preventDefault()
    const d = span(e.touches)
    if (!d || !last) return
    const scale = d / last
    if (Math.abs(Math.log(scale)) < 0.008) return
    last = d
    const x = (e.touches[0].clientX + e.touches[1].clientX) / 2
    const y = (e.touches[0].clientY + e.touches[1].clientY) / 2
    const target = doc.elementFromPoint(x, y) ?? doc.body
    target.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -100 * Math.log(scale), deltaMode: 0, ctrlKey: true,
      clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true, cancelable: true, composed: true,
    }))
  }
  // a touch keeps sending its moves to the element it started on; zooming re-renders the page and that element
  // can leave the document, so its moves are also taken on the element itself
  let held: EventTarget[] = []
  const release = () => { for (const t of held) { t.removeEventListener('touchmove', onMove as EventListener); t.removeEventListener('touchend', end as EventListener); t.removeEventListener('touchcancel', end as EventListener) } held = [] }
  const end = (e: TouchEvent) => { if (e.touches.length < 2) { last = null; release() } }
  doc.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return
    last = span(e.touches)
    e.preventDefault()
    release()
    for (const t of Array.from(e.touches)) if (t.target && !held.includes(t.target)) {
      held.push(t.target)
      t.target.addEventListener('touchmove', onMove as EventListener, { passive: false })
      t.target.addEventListener('touchend', end as EventListener)
      t.target.addEventListener('touchcancel', end as EventListener)
    }
  }, { capture: true, passive: false })
  doc.addEventListener('touchmove', onMove, { capture: true, passive: false })
  doc.addEventListener('touchend', end, { capture: true })
  doc.addEventListener('touchcancel', end, { capture: true })
  // WebKit's own pinch (page zoom) must not run
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(t, (e) => e.preventDefault(), { passive: false })
}

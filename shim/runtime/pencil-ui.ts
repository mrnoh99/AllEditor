// Apple Pencil on the app's menus and toolbars (not the document):
// - a press on a menu selected its words for copying, as if they were text: the app's chrome is not selectable;
//   the document, input fields and the AI's answers stay selectable
// - Scribble (iPadOS handwriting) took a pencil tap on a toolbar field (font size, page number…) for handwriting and
//   drew a dot there: each pencil touch tells the app (AllEditorDialogs.swift aeInstallScribbleGate) whether it is on
//   document text, and Scribble starts only there
const CSS = `
body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
input, textarea, select, [contenteditable]:not([contenteditable="false"]), [contenteditable]:not([contenteditable="false"]) *,
.ProseMirror, .ProseMirror *, .textLayer, .textLayer *, .text-layer, .text-layer *, [class*="ai-msg"], [class*="ai-msg"] *,
.ae-selectable, .ae-selectable * { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
/* the 한글 editor's page area: a drag stops at the page's edge instead of springing past it */
#scroll-container { overscroll-behavior: none; }
`
const DOC_TEXT = '[contenteditable]:not([contenteditable="false"]), .ProseMirror, textarea'
// fields in bars and menus take typed values, not handwriting
const CHROME = '.ribbon, .ribbon-body, .ribbon-tabs, [role="toolbar"], [role="menu"], [role="menubar"], .toolbar, .tb, .status-bar, .statusbar, .excel-header, header, nav, #tabs'

function post(allowed: boolean) {
  try { (window as any).webkit?.messageHandlers?.aeScribble?.postMessage(allowed) } catch {}
}
function onPointer(e: PointerEvent) {
  if (e.pointerType !== 'pen') return
  const t = e.target as Element | null
  const el = t && (t.nodeType === 1 ? t : (t as any).parentElement) as Element | null
  const docText = !!el?.closest?.(DOC_TEXT) && !el.closest(CHROME)
  post(docText)
  // a field outside the document is read-only while the pencil is down, which Scribble does not write into; on lifting
  // it takes the keyboard as before
  const field = el?.closest?.('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null
  if (field && !docText && !field.readOnly && !field.disabled) {
    field.readOnly = true
    const back = () => {
      field.readOnly = false
      el!.ownerDocument.removeEventListener('pointerup', back, true); el!.ownerDocument.removeEventListener('pointercancel', back, true)
      try { field.focus(); if ('select' in field && field.tagName === 'INPUT') field.select() } catch {}
    }
    el!.ownerDocument.addEventListener('pointerup', back, true); el!.ownerDocument.addEventListener('pointercancel', back, true)
    setTimeout(() => { if (field.readOnly) back() }, 1500)
  }
}

const done = new WeakSet<Document>()
function install(doc: Document) {
  if (done.has(doc)) return
  done.add(doc)
  const st = doc.createElement('style'); st.id = 'ae-pencil-ui'; st.textContent = CSS
  ;(doc.head ?? doc.documentElement).appendChild(st)
  doc.addEventListener('pointerdown', onPointer as any, true)
}

/** this page and the same-origin pages inside it (the 한글 editor's studio frame) */
export function installPencilUi() {
  const run = () => {
    install(document)
    const scan = (d: Document) => { for (const f of Array.from(d.querySelectorAll('iframe'))) { try { const cd = f.contentDocument; if (cd?.body) { install(cd); scan(cd) } } catch {} } }
    scan(document)
    new MutationObserver(() => scan(document)).observe(document.body, { childList: true, subtree: true })
    // a frame's own page replaces its document when it loads
    document.addEventListener('load', (e) => { const f = e.target as HTMLIFrameElement; if (f?.tagName === 'IFRAME') { try { if (f.contentDocument) install(f.contentDocument) } catch {} } }, true)
  }
  if (document.body) run(); else addEventListener('DOMContentLoaded', run)
}

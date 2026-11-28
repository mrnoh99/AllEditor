// The editors' choice dialogs (dialog.showMessageBox): every button the editor offers, in a card over the page.
// They were mapped onto confirm()'s two buttons, which lost a choice whenever there were three, or when the
// editor's Cancel was the same button as its default (the recovery prompt's 버리기 could not be chosen).
// Esc or a tap outside the card answers cancelId, as closing the desktop dialog does.
const CSS = `.ae-mb-back{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:16px;font:15px -apple-system,system-ui,sans-serif}
.ae-mb{background:#fff;color:#111;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.3);max-width:460px;width:100%;padding:20px 20px 16px}
.ae-mb-title{font-weight:600;font-size:17px;margin-bottom:8px;word-break:break-word;white-space:pre-wrap}
.ae-mb-body{opacity:.8;line-height:1.45;margin-bottom:16px;white-space:pre-wrap;word-break:break-word;max-height:50vh;overflow:auto}
.ae-mb-check{display:flex;gap:8px;align-items:center;margin:-4px 0 14px;opacity:.85}
.ae-mb-row{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.ae-mb-row button{border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;border-radius:9px;padding:8px 14px;font:inherit;min-height:40px}
.ae-mb-row button.def{background:#2b6cd4;border-color:#2b6cd4;color:#fff}
@media (prefers-color-scheme:dark){.ae-mb{background:#2c2c2e;color:#f2f2f7}}`

export interface MessageBoxOptions { message?: string; detail?: string; buttons?: string[]; defaultId?: number; cancelId?: number; checkboxLabel?: string; checkboxChecked?: boolean; title?: string }

export function showMessageBoxCard(o: MessageBoxOptions): Promise<{ response: number; checkboxChecked: boolean }> {
  const buttons = o.buttons?.length ? o.buttons : ['OK']
  const def = o.defaultId ?? 0
  // Electron: without cancelId, a button named Cancel/No answers Esc, else 0
  const cancel = o.cancelId ?? (() => { const i = buttons.findIndex((b) => /^(cancel|no|취소|아니오)$/i.test(b.trim())); return i >= 0 ? i : 0 })()
  return new Promise((done) => {
    const doc = document
    if (!doc.getElementById('ae-mb-css')) { const st = doc.createElement('style'); st.id = 'ae-mb-css'; st.textContent = CSS; (doc.head ?? doc.documentElement).appendChild(st) }
    const back = doc.createElement('div'); back.className = 'ae-mb-back'
    const box = doc.createElement('div'); box.className = 'ae-mb'; box.setAttribute('role', 'alertdialog')
    const t = doc.createElement('div'); t.className = 'ae-mb-title'; t.textContent = o.message || o.title || ''
    box.append(t)
    if (o.detail) { const d = doc.createElement('div'); d.className = 'ae-mb-body'; d.textContent = o.detail; box.append(d) }
    let cb: HTMLInputElement | null = null
    if (o.checkboxLabel) {
      const l = doc.createElement('label'); l.className = 'ae-mb-check'
      cb = doc.createElement('input'); cb.type = 'checkbox'; cb.checked = !!o.checkboxChecked
      l.append(cb, doc.createTextNode(o.checkboxLabel)); box.append(l)
    }
    const row = doc.createElement('div'); row.className = 'ae-mb-row'
    const finish = (i: number) => { back.remove(); doc.removeEventListener('keydown', key, true); done({ response: i, checkboxChecked: !!cb?.checked }) }
    // shown in the editor's order, the default last (where the eye ends, as on iPadOS)
    const order = buttons.map((_, i) => i).filter((i) => i !== def).concat(def < buttons.length ? [def] : [])
    for (const i of order) {
      const b = doc.createElement('button'); b.textContent = buttons[i]; if (i === def) b.className = 'def'
      b.onclick = () => finish(i); row.append(b)
    }
    box.append(row); back.append(box)
    back.onclick = (e) => { if (e.target === back) finish(cancel) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(cancel) } else if (e.key === 'Enter') { e.preventDefault(); finish(def) } }
    doc.addEventListener('keydown', key, true)
    ;(doc.body ?? doc.documentElement).append(back)
    ;(row.querySelector('.def') as HTMLButtonElement | null)?.focus()
  })
}

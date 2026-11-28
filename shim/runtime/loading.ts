// While a tab opens a document: a card over the editor says what is happening (reading from iCloud, opening), with the
// file's size and the seconds gone by, so a large file does not look stuck. It goes once the editor has settled: no
// elements added for a moment after the document was handed over. 숨기기 removes it at once.
import fs from './fs'

const ko = () => { try { return (JSON.parse(localStorage.getItem('alleditor.settings') || '{}').language ?? 'ko') === 'ko' } catch { return true } }
const mb = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')

export interface Loading { step(ko: string, en: string): void; sizeOf(path: string): void; settle(): void; done(): void }

export function showLoading(path: string | null): Loading | null {
  if (!path) return null
  const name = path.slice(path.lastIndexOf('/') + 1)
  const st = document.createElement('style')
  st.textContent = `#ae-loading{position:fixed;inset:0;z-index:2500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.18);font:15px -apple-system,system-ui,sans-serif}
#ae-loading .card{background:#fff;color:#111;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.25);padding:22px 26px;min-width:280px;max-width:80vw;text-align:center}
#ae-loading .spin{width:34px;height:34px;margin:0 auto 14px;border-radius:50%;border:3px solid rgba(43,108,212,.2);border-top-color:#2b6cd4;animation:ae-spin .9s linear infinite}
#ae-loading .name{font-weight:600;word-break:break-all;margin-bottom:6px}#ae-loading .msg{opacity:.75}#ae-loading .time{opacity:.5;font-size:13px;margin-top:4px}
#ae-loading button{margin-top:14px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;border-radius:9px;padding:6px 14px;font:inherit;font-size:13px}
@keyframes ae-spin{to{transform:rotate(360deg)}}
@media (prefers-color-scheme:dark){#ae-loading .card{background:#2c2c2e;color:#f2f2f7}}`
  const box = document.createElement('div'); box.id = 'ae-loading'
  const card = document.createElement('div'); card.className = 'card'
  const spin = document.createElement('div'); spin.className = 'spin'
  const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = name
  const msg = document.createElement('div'); msg.className = 'msg'
  const time = document.createElement('div'); time.className = 'time'
  const hide = document.createElement('button'); hide.textContent = ko() ? '숨기기' : 'Hide'
  card.append(spin, nm, msg, time, hide); box.append(card)
  const add = () => { (document.head ?? document.documentElement).append(st); document.body.append(box) }
  if (document.body) add(); else addEventListener('DOMContentLoaded', add)
  const t0 = Date.now()
  let size = ''
  const tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); time.textContent = (size ? size + ' · ' : '') + (s >= 2 ? (ko() ? `${s}초` : `${s} s`) : '') }, 500)
  let gone = false, quiet: any = null, cap: any = null, obs: MutationObserver | null = null
  const done = () => { if (gone) return; gone = true; clearInterval(tick); clearTimeout(quiet); clearTimeout(cap); obs?.disconnect(); box.remove(); st.remove() }
  hide.onclick = done
  const set = (k: string, e: string) => { msg.textContent = ko() ? k : e }
  set('불러오는 중…', 'Loading…')
  return {
    step: (k, e) => set(k, e),
    sizeOf: (p) => { try { const n = Number(fs.statSync(p).size); if (n > 0) size = mb(n) } catch {} },
    // the editor is drawing the document: done when nothing has been added to the page or its frames for a second
    // (at most 90 s)
    settle: () => {
      if (gone) return
      const wait = () => { clearTimeout(quiet); quiet = setTimeout(done, 1000) }
      obs = new MutationObserver((list) => { if (list.some((m) => !box.contains(m.target))) wait() })
      // the editors draw inside their own frames (same origin): those pages are watched too, as they appear
      const seen = new WeakSet<Document>()
      const watch = (d: Document | null | undefined) => {
        if (!d?.body || seen.has(d)) return
        seen.add(d); obs!.observe(d.body, { childList: true, subtree: true, characterData: true }); wait()
      }
      const scan = (d: Document) => { for (const f of Array.from(d.querySelectorAll('iframe'))) { try { const cd = f.contentDocument; if (cd) { watch(cd); scan(cd) } } catch {} } }
      watch(document)
      const frames = setInterval(() => { if (gone) clearInterval(frames); else scan(document) }, 400)
      wait(); cap = setTimeout(done, 90000)
    },
    done,
  }
}

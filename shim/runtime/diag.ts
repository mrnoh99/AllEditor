// 진단 정보: errors of every page (the home and each editor tab) are kept on the device, newest last, so that a problem
// seen on the iPad can be read in 설정 › 진단 정보 and copied into a report. Nothing leaves the device.
const KEY = 'alleditor.diag'
const MAX = 120

export interface DiagEntry { t: number; page: string; kind: string; msg: string }

export function readDiag(): DiagEntry[] { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
export function clearDiag() { try { localStorage.removeItem(KEY) } catch {} }

let installed = false
export function installDiag(page: string) {
  if (installed) return
  installed = true
  let last = ''
  const keep = (kind: string, msg: string) => {
    msg = String(msg || '').slice(0, 600)
    if (!msg || msg === last) return // the same error repeating is kept once
    last = msg
    try {
      const all = readDiag(); all.push({ t: Date.now(), page, kind, msg })
      localStorage.setItem(KEY, JSON.stringify(all.slice(-MAX)))
    } catch {}
  }
  addEventListener('error', (e) => keep('error', `${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`))
  addEventListener('unhandledrejection', (e) => { const r: any = e.reason; keep('promise', r?.stack ? String(r.stack).split('\n').slice(0, 3).join(' ← ') : String(r?.message ?? r)) })
  const ce = console.error.bind(console)
  console.error = (...a: any[]) => { ce(...a); keep('console', a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : (() => { try { return JSON.stringify(x) } catch { return String(x) } })())).join(' ')) }
}

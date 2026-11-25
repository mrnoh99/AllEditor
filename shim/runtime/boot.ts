import './process'
import { Buffer } from 'buffer'
const g = globalThis as any
// inside a tab (iframe) the native bridge only exists on the parent window
try { if (window.parent !== window && (window.parent as any).Capacitor && !g.Capacitor) g.Capacitor = (window.parent as any).Capacitor } catch {}
g.Buffer = g.Buffer ?? Buffer
// Node timers: setInterval(...).unref() / .ref() / .hasRef() (main-process code); browsers return a number
for (const name of ['setTimeout', 'setInterval'] as const) {
  const orig = g[name].bind(g)
  g[name] = (...a: any[]) => {
    const id = orig(...a)
    const t: any = Object(id)
    t.unref = () => t; t.ref = () => t; t.hasRef = () => true; t.refresh = () => t
    t[Symbol.toPrimitive] = () => id
    return t
  }
}
g.__dirname = '/app/out/main'; g.__filename = '/app/out/main/index.js'
g.global = g.global ?? g
// no cross-origin isolation in WKWebView: SharedArrayBuffer/Atomics.wait are unavailable
if (typeof g.SharedArrayBuffer === 'undefined') g.SharedArrayBuffer = ArrayBuffer
const A: any = Atomics
const origWait = A.wait
A.wait = (...a: any[]) => { try { return origWait.apply(Atomics, a) } catch { const end = Date.now() + Math.min(Number(a[3]) || 0, 200); while (Date.now() < end); return 'timed-out' } }

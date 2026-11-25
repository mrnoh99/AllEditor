// Runs the upstream Rust xlsx engine (native/xlsx-wasm, wasm32-wasip1) inside the WebView.
// The engine addresses files by path; this host mirrors those files between the app's
// memfs and the engine's private in-memory WASI tree around every request.
import { WASI, File as WFile, Directory as WDir, PreopenDirectory, OpenFile, ConsoleStdout } from '@bjorn3/browser_wasi_shim'
import { debug } from '../../node_modules/@bjorn3/browser_wasi_shim/dist/debug.js'
debug.enable(false)
import fs from './fs'

const scriptSrc: string = (document.currentScript as HTMLScriptElement | null)?.src || location.href

let instP: Promise<{ x: any; mem: () => WebAssembly.Memory; root: Map<string, any> }> | null = null
function load() {
  return (instP ??= (async () => {
    const bytes = await (await (globalThis as any).__realFetch(new URL('xlsx.wasm', scriptSrc).href)).arrayBuffer()
    const root = new Map<string, any>()
    const wasi = new WASI([], ['TMPDIR=/tmp'], [], )
    const pre = new PreopenDirectory('/', root)
    // stdin empty; stdout / stderr (engine diagnostics, panic messages) go to the console
    ;(wasi as any).fds = [new OpenFile(new WFile([])), ConsoleStdout.lineBuffered((m: string) => console.log('[xlsx]', m)),
      ConsoleStdout.lineBuffered((m: string) => console.warn('[xlsx]', m)), pre]
    const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: (wasi as any).wasiImport })
    ;(wasi as any).inst = instance
    const x: any = instance.exports
    return { x, mem: () => x.memory as WebAssembly.Memory, root }
  })())
}

/** WASI tree helpers */
function dirOf(root: Map<string, any>, parts: string[], create: boolean): Map<string, any> | null {
  let cur = root
  for (const p of parts) {
    let n = cur.get(p)
    if (!n) { if (!create) return null; n = new WDir(new Map()); cur.set(p, n) }
    if (!(n instanceof WDir)) return null
    cur = n.contents
  }
  return cur
}
const split = (p: string) => p.split('/').filter(Boolean)
function pushIn(root: Map<string, any>, path: string) {
  try {
    const st = fs.statSync(path)
    if (st.isDirectory()) { dirOf(root, split(path), true); return }
    if (!st.isFile()) return
    const parts = split(path), name = parts.pop()!
    const d = dirOf(root, parts, true)!
    d.set(name, new WFile(new Uint8Array(fs.readFileSync(path))))
  } catch { /* absent: target to be created by the engine */ }
}
function pullOut(root: Map<string, any>, wpath: string[], mpath: string) {
  const d = dirOf(root, wpath, false); if (!d) return
  for (const [name, n] of d) {
    const full = `${mpath}/${name}`
    if (n instanceof WDir) { fs.mkdirSync(full, { recursive: true }); pullOut(root, [...wpath, name], full) }
    else {
      const data: Uint8Array = n.data
      let same = false
      try { const cur = fs.readFileSync(full); same = cur.length === data.length && Buffer.compare(Buffer.from(cur), Buffer.from(data)) === 0 } catch {}
      if (!same) { fs.mkdirSync(mpath, { recursive: true }); fs.writeFileSync(full, data) }
    }
  }
}
const pathsOf = (o: any, out: string[] = []): string[] => {
  if (typeof o === 'string') { if (o.startsWith('/Documents') || o.startsWith('/tmp') || o.startsWith('/userData')) out.push(o) }
  else if (o && typeof o === 'object') for (const v of Object.values(o)) pathsOf(v, out)
  return out
}

let chain: Promise<unknown> = Promise.resolve()
/** one JSON request line -> one JSON response line (or null) */
export function xlsxRequest(line: string): Promise<string | null> {
  const run = async () => {
    const { x, mem, root } = await load()
    let paths: string[] = []
    try { paths = pathsOf(JSON.parse(line)) } catch {}
    for (const p of paths) pushIn(root, p)
    const enc = new TextEncoder().encode(line)
    const ptr = x.wasm_alloc(enc.length)
    new Uint8Array(mem().buffer, ptr, enc.length).set(enc)
    const r = x.engine_request(ptr, enc.length) as bigint
    x.wasm_free(ptr, enc.length)
    let resp: string | null = null
    if (r !== 0n) {
      const rp = Number(r >> 32n), rl = Number(r & 0xffffffffn)
      resp = new TextDecoder().decode(new Uint8Array(mem().buffer, rp, rl).slice())
      x.engine_free(rp, rl)
    }
    for (const p of paths) {
      const parts = split(p)
      const d = dirOf(root, parts.slice(0, -1), false)
      const n = d?.get(parts[parts.length - 1])
      if (n instanceof WFile) pullOut(root, parts.slice(0, -1), '/' + parts.slice(0, -1).join('/'))
      else if (n instanceof WDir) pullOut(root, parts, p)
    }
    if ((globalThis as any).__aeIpcTrace) console.log('[xlsx req]', line.slice(0, 1500), '\n[xlsx resp]', (resp ?? '').slice(0, 600))
    return resp
  }
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

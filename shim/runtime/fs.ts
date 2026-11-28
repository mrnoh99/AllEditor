// memfs-backed `fs` for the in-WebView "main process". Everything under DOCS_ROOT is
// mirrored to the app's iOS Documents folder (Files app > AllEditor) via the native bridge.
import { createFsFromVolume, Volume } from 'memfs'
import { Directory, Filesystem, isNative } from './native-files'

export const DOCS_ROOT = '/Documents'
export const vol = new Volume()
const fs: any = createFsFromVolume(vol)
for (const d of [DOCS_ROOT, '/tmp', '/userData', '/home']) vol.mkdirSync(d, { recursive: true })

// Browser preview (no native bridge): IndexedDB plays the role of the app's file storage,
// so tabs (iframes) still share files like they do on device.
const idbOpen = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('alleditor-fs', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const idbTx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => { const db = await idbOpen(); return new Promise<T>((res, rej) => { const r = f(db.transaction('f', mode).objectStore('f')); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) }
const native = isNative
export const USER_ROOT = '/userData'
const DOC_EXT_ROOT = () => DOCS_ROOT + '/'
const rootOf = (p: string) => (p.startsWith(USER_ROOT + '/') ? USER_ROOT : DOCS_ROOT)
const dirOfRoot = (r: string) => (r === USER_ROOT ? Directory.Support : Directory.Documents)
const rel = (p: string) => p.slice(rootOf(p).length + 1)
const dirty = new Set<string>()
let timer: any = null
const norm = (p: unknown) => (typeof p === 'string' ? (p.startsWith('/') ? p : '/' + p) : null)
// the document this page (one tab = one document) edits: the file it opened, else the last office file it saved
const DOC_EXT = /\.(docx|dotx|doc|odt|pptx|potx|ppt|odp|xlsx|xlsm|xls|ods|csv|tsv|pdf|hwp|hwpx)$/i
let docPath: string | null = (() => { try { const o = new URLSearchParams(location.search).get('open'); return o && DOC_EXT.test(o) ? o : null } catch { return null } })()
;(globalThis as any).__aeDocPath = () => docPath
;(globalThis as any).__aeReadFile = (p: string) => new Uint8Array(fs.readFileSync(p))
/** paths that live only in this page's memory (never mirrored to the device), e.g. the AI settings with keys */
const memoryOnly = new Set<string>()
/** how many times this page has written a document (the home's "save before closing?" waits for the next one) */
let docWrites = 0
export const documentWrites = () => docWrites
export const keepInMemory = (p: string) => { memoryOnly.add(p) }
function mark(...ps: unknown[]) {
  for (const p of ps) {
    const n = norm(p)
    if (n && memoryOnly.has(n)) continue
    if (n && lazy.has(n) && inVol(n)) lazy.delete(n)
    if (n && n.startsWith(DOC_EXT_ROOT()) && DOC_EXT.test(n) && !n.split('/').pop()!.startsWith('.')) { docPath = n; docWrites++ }
    if (n && (n.startsWith(DOCS_ROOT + '/') && !n.includes('/.') || n.startsWith(USER_ROOT + '/'))) dirty.add(n)
  }
  if (dirty.size && !timer) timer = setTimeout(flush, 250)
}
const b64 = (u: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
export async function flush() {
  timer = null
  const paths = [...dirty]; dirty.clear()
  if (!native()) {
    for (const p of paths) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) await idbTx('readwrite', (st) => st.put(new Uint8Array(fs.readFileSync(p)), p))
        else if (!fs.existsSync(p)) await idbTx('readwrite', (st) => st.delete(p))
      } catch (e) { console.warn('[idb mirror]', p, e) }
    }
    return
  }
  for (const p of paths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile())
        await Filesystem.writeFile({ path: rel(p), directory: dirOfRoot(rootOf(p)), recursive: true,
          data: b64(fs.readFileSync(p)) })
      // only a path that is really gone is deleted natively: a (re)created directory must never wipe
      // the files already stored in it (mkdirSync marks its path dirty too)
      else if (!fs.existsSync(p)) await Filesystem.deleteFile({ path: rel(p), directory: dirOfRoot(rootOf(p)) }).catch(() => {})
    } catch (e) { console.warn('[fs mirror]', p, e) }
  }
}
// wrap mutating calls (first arg = path; rename/copy also touch second)
const wrap = (obj: any, name: string, two = false) => {
  const orig = obj[name]
  if (!orig) return
  obj[name] = function (this: any, ...a: any[]) {
    const r = orig.apply(this, a)
    const m = () => mark(a[0], two ? a[1] : undefined)
    if (r && typeof r.then === 'function') return r.then((v: any) => (m(), v))
    m(); return r
  }
}
for (const n of ['writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'mkdirSync']) wrap(fs, n)
for (const n of ['renameSync', 'copyFileSync']) wrap(fs, n, true)
for (const n of ['writeFile', 'appendFile', 'unlink', 'rm', 'mkdir']) wrap(fs.promises, n)
for (const n of ['rename', 'copyFile']) wrap(fs.promises, n, true)
const cws = fs.createWriteStream
fs.createWriteStream = (p: any, ...a: any[]) => { const s = cws.call(fs, p, ...a); s.on('close', () => mark(p)); return s }

/** load Documents from iOS into memfs (call once before any IPC is served) */
export async function hydrate() {
  const openedDoc = docPath // loading the stored files below is not "saving a document"
  try { await hydrateInner() } finally { docPath = openedDoc }
}
let openedDoc: string | null = null
async function hydrateInner() {
  openedDoc = docPath
  // dev/test hook: files injected by the page before boot
  const seed = (globalThis as any).__seedFiles
  if (seed) for (const [n, d] of Object.entries<string>(seed)) { const bin = atob(d); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); fs.writeFileSync(`${DOCS_ROOT}/${n}`, u) }
  if (!native()) {
    try {
      const keys = (await idbTx('readonly', (st) => st.getAllKeys())) as string[]
      for (const k of keys) {
        const v = (await idbTx('readonly', (st) => st.get(k))) as Uint8Array
        fs.mkdirSync(String(k).slice(0, String(k).lastIndexOf('/')), { recursive: true }); fs.writeFileSync(String(k), v)
      }
    } catch (e) { console.warn('[idb hydrate]', e) }
    dirty.clear(); return
  }
  const walk = async (base: string, directory: typeof Directory[keyof typeof Directory], dir: string) => {
    const { files } = await Filesystem.readdir({ path: dir, directory }).catch(() => ({ files: [] as any[] }))
    for (const f of files) {
      const p = dir ? `${dir}/${f.name}` : f.name
      // in memory every name is composed (NFC), whatever form the device keeps (see "Korean names" below)
      const key = `${base}/${p}`.normalize('NFC')
      if (f.name.startsWith('.')) continue
      if (f.type === 'directory') {
        // save backups are written there, never read back by the app
        if (base === DOCS_ROOT && !dir && f.name === 'Backup') continue
        vol.mkdirSync(key, { recursive: true }); await walk(base, directory, p)
      } else if (base === DOCS_ROOT && key !== openedDoc?.normalize('NFC')) {
        // memory and time: the other documents are only listed; their bytes load when a page needs them (ensureLoaded).
        // A file iCloud has not downloaded yet is listed the same way (cloud) and downloads when it is opened.
        lazy.set(key, { size: f.size ?? 0, mtime: f.mtime ?? 0 })
      } else if ((f.size ?? 0) <= 30e6) {
        const { data } = await Filesystem.readFile({ path: p, directory })
        const bin = atob(data as string); const u = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
        vol.mkdirSync(key.slice(0, key.lastIndexOf('/')), { recursive: true })
        vol.writeFileSync(key, u)
      }
    }
  }
  const saved = new Set(dirty); await walk(DOCS_ROOT, Directory.Documents, ''); await walk(USER_ROOT, Directory.Support, '')
  for (const p of saved) dirty.add(p)
  dirty.clear()
}

// ---- Korean names in two Unicode forms ----
// iCloud Drive and the Mac keep a name as it was typed, often decomposed (NFD: 한 = ㅎ+ㅏ+ㄴ), while the app writes
// composed names (NFC). The device file system treats both as the same file; this in-memory one does not, so a
// name in the other form found nothing and the editor opened a blank document. A path that does not exist as
// given is looked up in the other form too.
{
  const f: any = fs
  const raw = { ex: f.existsSync.bind(f) }
  // the name as given when it exists, else its other form when that exists, else the composed form that memory keeps
  const alt = (p: any): any => {
    if (typeof p !== 'string' || raw.ex(p)) return p
    const c = p.normalize('NFC'); if (raw.ex(c)) return c
    const d = p.normalize('NFD'); if (raw.ex(d)) return d
    return c
  }
  const one = ['readFileSync', 'statSync', 'lstatSync', 'existsSync', 'openSync', 'accessSync', 'writeFileSync', 'appendFileSync',
    'mkdirSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'readdirSync', 'realpathSync', 'utimesSync', 'truncateSync', 'createReadStream',
    'createWriteStream', 'readFile', 'writeFile', 'appendFile', 'stat', 'lstat', 'access', 'open', 'mkdir', 'unlink', 'rm', 'readdir']
  const two = ['renameSync', 'copyFileSync', 'cpSync', 'rename', 'copyFile']
  const patch = (o: any, names: string[], both: boolean) => {
    for (const name of names) {
      const orig = o?.[name]; if (typeof orig !== 'function') continue
      o[name] = both
        ? function (this: any, x: any, y: any, ...rest: any[]) { return orig.call(this, alt(x), alt(y), ...rest) }
        : function (this: any, x: any, ...rest: any[]) { return orig.call(this, alt(x), ...rest) }
    }
  }
  patch(f, one, false); patch(f, two, true)
  patch(f.promises, ['readFile', 'writeFile', 'appendFile', 'stat', 'lstat', 'access', 'open', 'mkdir', 'unlink', 'rm', 'readdir', 'truncate', 'utimes', 'realpath'], false)
  patch(f.promises, ['rename', 'copyFile', 'cp'], true)
}

// ---- lazily loaded documents --------------------------------------------------------------------------------
// Every page (the office home and each tab) has its own in-memory file system. Loading the whole Documents folder
// into each of them costs (size of all documents) × (open tabs) of memory, which a large iPad library cannot afford.
// A page loads at start only the document it opens; the others are listed (name, size, date) until it needs them.
const lazy = new Map<string, { size: number; mtime: number }>()
const npath = (p: unknown) => (typeof p === 'string' ? p.replace(/\/+$/, '').normalize('NFC') : '')
const inVol = (p: string) => { try { vol.statSync(p); return true } catch { return false } }
const lazyStat = (p: string) => {
  const m = lazy.get(p)!; const t = new Date(m.mtime)
  return { size: m.size, mtimeMs: m.mtime, mtime: t, ctimeMs: m.mtime, ctime: t, birthtimeMs: m.mtime, birthtime: t, atimeMs: m.mtime, atime: t,
    mode: 0o100644, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false, isBlockDevice: () => false, isCharacterDevice: () => false }
}
/** loads a listed-only document's bytes from the device (call before reading it) */
export async function ensureLoaded(path: string) {
  const p = npath(path)
  if (!lazy.has(p) || inVol(p)) { lazy.delete(p); return }
  const { data } = await Filesystem.readFile({ path: rel(p), directory: dirOfRoot(rootOf(p)) })
  const bin = atob(data as string); const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  vol.mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true }); vol.writeFileSync(p, u) // not a change: no mirror write
  lazy.delete(p)
}
/** the document a tab opens is read from the device itself when memory does not hold its bytes: listed-only, or kept
 *  under its name in the other Unicode form, or not seen by the listing at all (iCloud still placing it) */
export async function loadOpenedDocument(path: string) {
  const p = npath(path)
  if (!p || !native()) return
  try { await ensureLoaded(p) } catch (e) { console.warn('[open] lazy load', e) }
  try { if (vol.statSync(p).size > 0) return } catch {}
  const root = rootOf(p); if (!root) return
  for (const name of [rel(p), rel(p).normalize('NFD')]) {
    try {
      const { data } = await Filesystem.readFile({ path: name, directory: dirOfRoot(root) })
      const bin = atob(data as string); const u = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
      if (!u.length) continue
      vol.mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true }); vol.writeFileSync(p, u); lazy.delete(p)
      return
    } catch (e) { console.warn('[open] device read', name, e) }
  }
}
{
  const f: any = fs
  const ex = f.existsSync, st = f.statSync, ls = f.lstatSync, rd = f.readdirSync, ul = f.unlinkSync
  f.existsSync = (p: any) => ex.call(f, p) || lazy.has(npath(p))
  f.statSync = (p: any, o?: any) => { const n = npath(p); return lazy.has(n) && !inVol(n) ? lazyStat(n) : st.call(f, p, o) }
  f.lstatSync = (p: any, o?: any) => { const n = npath(p); return lazy.has(n) && !inVol(n) ? lazyStat(n) : ls.call(f, p, o) }
  f.readdirSync = (p: any, o?: any) => {
    const out = rd.call(f, p, o); const dir = npath(p)
    if (o && typeof o === 'object' && o.withFileTypes) return out
    const have = new Set(out.map(String))
    for (const k of lazy.keys()) if (k.slice(0, k.lastIndexOf('/')) === dir) { const n = k.slice(dir.length + 1); if (!have.has(n)) out.push(n) }
    return out
  }
  f.unlinkSync = (p: any) => { const n = npath(p); if (lazy.has(n) && !inVol(n)) { lazy.delete(n); mark(n); return } return ul.call(f, p) }
  const pst = f.promises.stat
  f.promises.stat = async (p: any, o?: any) => { const n = npath(p); return lazy.has(n) && !inVol(n) ? lazyStat(n) : pst.call(f.promises, p, o) }
  const prf = f.promises.readFile, rf = f.readFile
  // async readers can wait for the bytes
  f.promises.readFile = async (p: any, o?: any) => { if (lazy.has(npath(p))) await ensureLoaded(npath(p)); return prf.call(f.promises, p, o) }
  f.readFile = (p: any, ...a: any[]) => { if (lazy.has(npath(p))) { ensureLoaded(npath(p)).then(() => rf.call(f, p, ...a), (e) => a[a.length - 1]?.(e)); return } return rf.call(f, p, ...a) }
}

export default fs
export const promises = fs.promises
export const constants = fs.constants
export const {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, lstatSync, unlinkSync,
  rmSync, rmdirSync, renameSync, copyFileSync, appendFileSync, accessSync, realpathSync, openSync,
  closeSync, readSync, writeSync, fstatSync, ftruncateSync, utimesSync, chmodSync, mkdtempSync,
  watch, watchFile, unwatchFile, createReadStream, createWriteStream, readFile, writeFile, readdir,
  stat, lstat, mkdir, unlink, rm, rmdir, rename, copyFile, appendFile, access, realpath, open, close,
  read, write, fstat, utimes, chmod, exists, mkdtemp, truncate, truncateSync, symlinkSync, symlink,
  readlinkSync, readlink, fsyncSync, fdatasyncSync, fsync, fdatasync, chownSync, lchownSync, linkSync, link, cpSync, cp, statfsSync, opendirSync, opendir,
} = fs

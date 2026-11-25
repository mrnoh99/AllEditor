// memfs-backed `fs` for the in-WebView "main process". Everything under DOCS_ROOT is
// mirrored to the app's iOS Documents folder (Files app > AllEditor) via Capacitor.
import { createFsFromVolume, Volume } from 'memfs'
import { Directory, Filesystem } from './native-files'

export const DOCS_ROOT = '/Documents'
export const vol = new Volume()
const fs: any = createFsFromVolume(vol)
for (const d of [DOCS_ROOT, '/tmp', '/userData', '/home']) vol.mkdirSync(d, { recursive: true })

// Browser preview (no native bridge): IndexedDB plays the role of the app's file storage,
// so tabs (iframes) still share files like they do on device.
const idbOpen = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('alleditor-fs', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const idbTx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => { const db = await idbOpen(); return new Promise<T>((res, rej) => { const r = f(db.transaction('f', mode).objectStore('f')); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) }
const native = () => (window as any).Capacitor?.isNativePlatform?.() === true
export const USER_ROOT = '/userData'
const rootOf = (p: string) => (p.startsWith(USER_ROOT + '/') ? USER_ROOT : DOCS_ROOT)
const dirOfRoot = (r: string) => (r === USER_ROOT ? Directory.Support : Directory.Documents)
const rel = (p: string) => p.slice(rootOf(p).length + 1)
const dirty = new Set<string>()
let timer: any = null
const norm = (p: unknown) => (typeof p === 'string' ? (p.startsWith('/') ? p : '/' + p) : null)
function mark(...ps: unknown[]) {
  for (const p of ps) {
    const n = norm(p)
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
        else await idbTx('readwrite', (st) => st.delete(p))
      } catch (e) { console.warn('[idb mirror]', p, e) }
    }
    return
  }
  for (const p of paths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile())
        await Filesystem.writeFile({ path: rel(p), directory: dirOfRoot(rootOf(p)), recursive: true,
          data: b64(fs.readFileSync(p)) })
      else await Filesystem.deleteFile({ path: rel(p), directory: dirOfRoot(rootOf(p)) }).catch(() => {})
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
      if (f.name.startsWith('.') || (f.size ?? 0) > 30e6) continue
      if (f.type === 'directory') { vol.mkdirSync(`${base}/${p}`, { recursive: true }); await walk(base, directory, p) }
      else {
        const { data } = await Filesystem.readFile({ path: p, directory })
        const bin = atob(data as string); const u = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
        fs.writeFileSync(`${base}/${p}`, u)
      }
    }
  }
  const saved = new Set(dirty); await walk(DOCS_ROOT, Directory.Documents, ''); await walk(USER_ROOT, Directory.Support, '')
  for (const p of saved) dirty.add(p)
  dirty.clear()
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

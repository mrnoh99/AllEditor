// memfs-backed `fs` for the in-WebView "main process". Everything under DOCS_ROOT is
// mirrored to the app's iOS Documents folder (Files app > AllEditor) via Capacitor.
import { createFsFromVolume, Volume } from 'memfs'
import { Directory, Filesystem } from './native-files'

export const DOCS_ROOT = '/Documents'
export const vol = new Volume()
const fs: any = createFsFromVolume(vol)
for (const d of [DOCS_ROOT, '/tmp', '/userData', '/home']) vol.mkdirSync(d, { recursive: true })

const native = () => (window as any).Capacitor?.isNativePlatform?.() === true
const rel = (p: string) => p.slice(DOCS_ROOT.length + 1)
const dirty = new Set<string>()
let timer: any = null
const norm = (p: unknown) => (typeof p === 'string' ? (p.startsWith('/') ? p : '/' + p) : null)
function mark(...ps: unknown[]) {
  for (const p of ps) {
    const n = norm(p)
    if (n && n.startsWith(DOCS_ROOT + '/') && !n.includes('/.')) dirty.add(n)
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
  if (!native()) return
  for (const p of paths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile())
        await Filesystem.writeFile({ path: rel(p), directory: Directory.Documents, recursive: true,
          data: b64(fs.readFileSync(p)) })
      else await Filesystem.deleteFile({ path: rel(p), directory: Directory.Documents }).catch(() => {})
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
  if (!native()) return
  const walk = async (dir: string) => {
    const { files } = await Filesystem.readdir({ path: dir, directory: Directory.Documents }).catch(() => ({ files: [] as any[] }))
    for (const f of files) {
      const p = dir ? `${dir}/${f.name}` : f.name
      if (f.name.startsWith('.') || (f.size ?? 0) > 30e6) continue
      if (f.type === 'directory') { vol.mkdirSync(`${DOCS_ROOT}/${p}`, { recursive: true }); await walk(p) }
      else {
        const { data } = await Filesystem.readFile({ path: p, directory: Directory.Documents })
        const bin = atob(data as string); const u = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
        fs.writeFileSync(`${DOCS_ROOT}/${p}`, u)
      }
    }
  }
  const saved = new Set(dirty); await walk('')
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

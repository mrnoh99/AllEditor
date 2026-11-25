import { Directory, Filesystem } from '../shim/runtime/native-files'

const APP_BY_EXT: Record<string, string> = {
  docx: 'docs', dotx: 'docs', doc: 'docs', dot: 'docs', odt: 'docs', ott: 'docs', hwp: 'docs', hwpx: 'docs',
  pptx: 'slides', potx: 'slides', ppt: 'slides', odp: 'slides', otp: 'slides',
  xlsx: 'sheets', xlsm: 'sheets', xls: 'sheets', ods: 'sheets', ots: 'sheets', csv: 'sheets', tsv: 'sheets',
  pdf: 'pdf',
}
const LABEL: Record<string, string> = { docs: 'Docs', slides: 'Slides', sheets: 'Sheets', pdf: 'PDF' }
const ext = (n: string) => n.split('.').pop()!.toLowerCase()
const appFor = (n: string) => APP_BY_EXT[ext(n)]

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const isNative = () => (window as any).Capacitor?.isNativePlatform?.() === true

function open(app: string, name?: string) {
  location.href = `./${app}/index.html` + (name ? `?open=${encodeURIComponent('/Documents/' + name)}` : '')
}

async function toBase64(f: File): Promise<string> {
  const u = new Uint8Array(await f.arrayBuffer())
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}

async function importAndOpen(f: File) {
  const app = appFor(f.name)
  if (!app) { alert(`Unsupported file type: ${f.name}`); return }
  const name = f.name.replace(/[\\/:*?"<>|]/g, '_')
  if (isNative()) await Filesystem.writeFile({ path: name, directory: Directory.Documents, data: await toBase64(f), recursive: true })
  else sessionStorage.setItem('alleditor.web.' + name, await toBase64(f)) // browser preview only
  open(app, name)
}

const fmt = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')

async function renderList() {
  const list = $('files'); list.textContent = ''
  if (!isNative()) { list.innerHTML = '<p class="empty">File list is available in the iOS app.</p>'; return }
  const { files } = await Filesystem.readdir({ path: '', directory: Directory.Documents }).catch(() => ({ files: [] as any[] }))
  const rows = files.filter((f: any) => f.type === 'file' && !f.name.startsWith('.') && appFor(f.name))
    .sort((a: any, b: any) => (b.mtime ?? 0) - (a.mtime ?? 0))
  if (!rows.length) { list.innerHTML = '<p class="empty">No documents yet. Tap “Open local file” or create a new one.</p>'; return }
  for (const f of rows) {
    const row = document.createElement('div'); row.className = 'row'
    const btn = document.createElement('button'); btn.className = 'file'
    btn.innerHTML = `<span class="tag ${appFor(f.name)}">${LABEL[appFor(f.name)]}</span><span class="nm"></span><span class="sz">${fmt(f.size ?? 0)}</span>`
    btn.querySelector('.nm')!.textContent = f.name
    btn.onclick = () => open(appFor(f.name), f.name)
    const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Delete')
    del.onclick = async () => {
      if (!confirm(`Delete ${f.name}?`)) return
      await Filesystem.deleteFile({ path: f.name, directory: Directory.Documents }); renderList()
    }
    row.append(btn, del); list.append(row)
  }
}

$('openFile').onclick = () => $<HTMLInputElement>('picker').click()
$<HTMLInputElement>('picker').onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void importAndOpen(f) }
document.querySelectorAll<HTMLElement>('[data-new]').forEach((b) => (b.onclick = () => open(b.dataset.new!)))
void renderList()
window.addEventListener('pageshow', () => void renderList())

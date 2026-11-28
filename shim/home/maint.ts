// 설정 › 저장 공간 정리 and 진단 정보, and the backup pruning the home runs at start.
// The folders are read from the device itself (the pages only list what they need).
import { Filesystem, Directory, isTauriOffice } from '../runtime/native-files'
import { readDiag, clearDiag } from '../runtime/diag'

interface DevFile { path: string; size: number; mtime: number }
const nfc = (s: string) => s.normalize('NFC')

async function listDevice(dir: string): Promise<DevFile[]> {
  const out: DevFile[] = []
  const walk = async (d: string) => {
    const { files } = await Filesystem.readdir({ path: d, directory: Directory.Documents }).catch(() => ({ files: [] as any[] }))
    for (const f of files as any[]) {
      const p = d ? `${d}/${f.name}` : String(f.name)
      if (f.type === 'directory') await walk(p)
      else out.push({ path: p, size: Number(f.size ?? 0), mtime: Number(f.mtime ?? 0) })
    }
  }
  await walk(dir)
  return out
}
/** the name a folder has on the device (a Korean name may be stored decomposed) */
async function deviceFolder(name: string): Promise<string | null> {
  const { files } = await Filesystem.readdir({ path: '', directory: Directory.Documents }).catch(() => ({ files: [] as any[] }))
  const f = (files as any[]).find((x) => x.type === 'directory' && nfc(String(x.name)) === nfc(name))
  return f ? String(f.name) : null
}
const del = (path: string) => Filesystem.deleteFile({ path, directory: Directory.Documents }).catch(() => {})
const mb = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(n ? 1 : 0, Math.round(n / 1024)) + ' KB')

const BACKUP_DAYS = 30
/** save backups (AllEditor › Backup) older than 30 days are removed; run once a day at most */
export async function pruneBackups() {
  if (!isTauriOffice()) return
  try {
    const last = Number(localStorage.getItem('alleditor.backupPruned') || 0)
    if (Date.now() - last < 864e5) return
    localStorage.setItem('alleditor.backupPruned', String(Date.now()))
  } catch {}
  const old = Date.now() - BACKUP_DAYS * 864e5
  for (const f of await listDevice('Backup')) if (f.mtime && f.mtime < old) await del(f.path)
}

type El = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => HTMLElementTagNameMap[K]

export function renderCleanup(wrap: HTMLElement, el: El, ko: boolean, toast: (m: string) => void) {
  const h = el('h2', '', ko ? '저장 공간 정리' : 'Storage'); h.id = 'cleanup'; wrap.append(h)
  const box = el('div', 'group'); wrap.append(box)
  if (!isTauriOffice()) { box.append(el('p', 'hint', ko ? 'iPad 앱에서 쓸 수 있습니다.' : 'Available in the iPad app.')); return }
  const draw = async () => {
    box.textContent = ''; box.append(el('p', 'hint', ko ? '살펴보는 중…' : 'Looking…'))
    const rows: Array<{ label: string; sub: string; files: DevFile[]; folder?: string; action: string; confirm: string }> = []
    const backup = await listDevice('Backup')
    rows.push({ label: ko ? '저장 전 백업 (Backup)' : 'Save backups (Backup)', sub: ko ? `${BACKUP_DAYS}일이 지난 백업은 저절로 지워집니다` : `Backups older than ${BACKUP_DAYS} days are removed by themselves`, files: backup, folder: 'Backup', action: ko ? '모두 지우기' : 'Remove all', confirm: ko ? '저장 전 백업을 모두 지울까요?' : 'Remove all save backups?' })
    for (const [name, what] of [['HWP', ko ? 'HWPX로 바꾸기 전 원본 사본' : 'copies converted to HWPX'], ['Pages', ko ? 'Word로 바꾸기 전 원본 사본' : 'copies converted to Word'], ['Keynote', ko ? 'PowerPoint로 바꾸기 전 원본 사본' : 'copies converted to PowerPoint'], ['Numbers', ko ? 'Excel로 바꾸기 전 원본 사본' : 'copies converted to Excel']] as const) {
      const files = await listDevice(name)
      if (files.length) rows.push({ label: `${name}`, sub: what, files, action: ko ? '사본 지우기' : 'Remove copies', confirm: ko ? `${name} 폴더의 원본 사본을 모두 지울까요?\n변환된 문서는 그대로 있습니다.` : `Remove every copy in ${name}?\nThe converted documents stay.` })
    }
    for (const legacy of ['한글', 'Hangul']) {
      const real = await deviceFolder(legacy)
      if (!real) continue
      const files = await listDevice(real)
      rows.push({ label: ko ? `예전 폴더 ${legacy}` : `Old folder ${legacy}`, sub: ko ? '이제 쓰지 않습니다 (한글 문서는 HWPX). 필요한 파일은 먼저 옮기세요' : 'No longer used (Hangul documents are in HWPX). Move what you need first', files, folder: real, action: ko ? '폴더 지우기' : 'Remove folder', confirm: ko ? `예전 폴더 ${legacy}와 그 안의 파일 ${files.length}개를 지울까요?` : `Remove the old folder ${legacy} and its ${files.length} files?` })
    }
    const strays = (await listDevice('')).filter((f) => /\.bak$/i.test(f.path) && !f.path.startsWith('Backup/'))
    if (strays.length) rows.push({ label: ko ? '흩어진 .bak 파일' : 'Stray .bak files', sub: ko ? '예전 버전이 문서 옆에 남긴 백업' : 'Backups an older version left beside documents', files: strays, action: ko ? '지우기' : 'Remove', confirm: ko ? `.bak 파일 ${strays.length}개를 지울까요?` : `Remove ${strays.length} .bak files?` })
    box.textContent = ''
    for (const r of rows) {
      const size = r.files.reduce((a, f) => a + f.size, 0)
      const row = el('div', 'fld')
      const txt = el('span', 'fl'); txt.append(el('b', '', r.label), el('br'), el('small', 'nm', `${r.sub} · ${r.files.length}${ko ? '개' : ' files'} · ${mb(size)}`))
      const b = el('button', 'mini', r.action); b.disabled = !r.files.length && !r.folder
      b.onclick = async () => {
        if (!confirm(r.confirm)) return
        b.disabled = true
        if (r.folder && r.folder !== 'Backup') await del(r.folder) // the whole old folder
        else for (const f of r.files) await del(f.path)
        toast(ko ? '지웠습니다' : 'Removed'); void draw()
      }
      row.append(txt, b); box.append(row)
    }
  }
  void draw()
}

export function renderDiagnostics(wrap: HTMLElement, el: El, ko: boolean, toast: (m: string) => void, version: () => string) {
  const h = el('h2', '', ko ? '진단 정보' : 'Diagnostics'); h.id = 'diag'; wrap.append(h)
  const box = el('div', 'group'); wrap.append(box)
  const draw = () => {
    box.textContent = ''
    const all = readDiag()
    const fmt = (e: { t: number; page: string; kind: string; msg: string }) => `${new Date(e.t).toLocaleString()} [${e.page}/${e.kind}] ${e.msg}`
    box.append(el('p', 'hint', all.length ? (ko ? `최근 오류 ${all.length}개 (이 iPad에만 보관, 밖으로 보내지 않습니다)` : `${all.length} recent errors (kept on this iPad only)`) : (ko ? '기록된 오류가 없습니다.' : 'No errors recorded.')))
    if (all.length) {
      const pre = el('pre', 'diag'); pre.textContent = all.slice(-30).reverse().map(fmt).join('\n')
      pre.style.cssText = 'max-height:240px;overflow:auto;font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all;margin:6px 12px;opacity:.85'
      box.append(pre)
      const copy = el('button', 'mini', ko ? '복사' : 'Copy')
      copy.onclick = async () => {
        const text = `AllEditor ${version()} · ${navigator.userAgent}\n` + all.map(fmt).join('\n')
        try { await navigator.clipboard.writeText(text); toast(ko ? '복사했습니다' : 'Copied') } catch { prompt(ko ? '아래 내용을 복사하세요' : 'Copy this', text.slice(0, 4000)) }
      }
      const clr = el('button', 'mini', ko ? '지우기' : 'Clear')
      clr.onclick = () => { clearDiag(); draw() }
      const row = el('div', 'fld'); row.append(el('span', 'fl', ''), copy, clr); box.append(row)
    }
  }
  draw()
}

/** 이전 판으로 되돌리기: the copy a save kept of the document as it was before (Backup/<folder>/<name>.bak). 되살리기
 *  swaps the two, so the version replaced is kept as the backup in turn and the step can be undone. */
export function renderVersions(wrap: HTMLElement, el: El, ko: boolean, toast: (m: string) => void, isOpen: (docPath: string) => boolean, after: () => void) {
  const h = el('h2', '', ko ? '이전 판으로 되돌리기' : 'Earlier versions'); h.id = 'versions'; wrap.append(h)
  const box = el('div', 'group'); wrap.append(box)
  if (!isTauriOffice()) { box.append(el('p', 'hint', ko ? 'iPad 앱에서 쓸 수 있습니다.' : 'Available in the iPad app.')); return }
  const draw = async () => {
    box.textContent = ''
    const baks = (await listDevice('Backup')).filter((f) => /\.bak$/i.test(f.path)).sort((a, b) => b.mtime - a.mtime)
    if (!baks.length) { box.append(el('p', 'hint', ko ? '저장 전 백업이 없습니다. 한글 문서를 저장하면 그 전 상태가 여기에 남습니다.' : 'No backups yet. Saving a Hangul document keeps the state before it here.')); return }
    for (const f of baks.slice(0, 50)) {
      const doc = f.path.slice('Backup/'.length).replace(/\.bak$/i, '')
      const row = el('div', 'fld')
      const txt = el('span', 'fl'); txt.append(el('b', '', doc.slice(doc.lastIndexOf('/') + 1)), el('br'), el('small', 'nm', `${doc.slice(0, doc.lastIndexOf('/') + 1) || ''}${ko ? ' · 저장 전 상태 ' : ' · before the save of '}${new Date(f.mtime).toLocaleString()} · ${mb(f.size)}`))
      const b = el('button', 'mini', ko ? '되살리기' : 'Restore')
      b.onclick = async () => {
        if (isOpen(`/Documents/${doc}`)) { alert(ko ? '이 문서가 열려 있습니다. 탭을 닫은 뒤 되살리세요.' : 'This document is open. Close its tab first.'); return }
        if (!confirm(ko ? `${doc}\n\n${new Date(f.mtime).toLocaleString()} 저장 전 상태로 되돌릴까요?\n지금 상태는 백업으로 남아 다시 되돌릴 수 있습니다.` : `${doc}\n\nGo back to the state before the save of ${new Date(f.mtime).toLocaleString()}?\nThe current state is kept as the backup, so this can be undone.`)) return
        b.disabled = true
        try {
          const old = (await Filesystem.readFile({ path: f.path, directory: Directory.Documents })).data as string
          const cur = await Filesystem.readFile({ path: doc, directory: Directory.Documents }).then((r) => r.data as string, () => null)
          await Filesystem.writeFile({ path: doc, data: old, directory: Directory.Documents })
          if (cur) await Filesystem.writeFile({ path: f.path, data: cur, directory: Directory.Documents })
          toast(ko ? '되살렸습니다' : 'Restored'); after(); void draw()
        } catch (e: any) { alert((ko ? '되살리지 못했습니다: ' : 'Could not restore: ') + (e?.message ?? e)); b.disabled = false }
      }
      row.append(txt, b); box.append(row)
    }
  }
  void draw()
}

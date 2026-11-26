// AllEditor shell: Home (files), Settings, and multi-tab hosting of the editor apps (one iframe per tab).
import fs, { DOCS_ROOT, USER_ROOT, hydrate, flush, ensureLoaded } from '../runtime/fs'
import { AI_PROVIDERS, defaultAiSettings, sanitizeAiSettings } from '@genoffice/ai-provider'
import { LANGS, tr } from './i18n'
import { convertIwork, IWORK_EXT } from '../iwork/convert'
import { getPrinters, setPrinters, sendToPrinter, testPdf, type PrinterCfg } from '../runtime/print'
import { nativeShare, nativeAi, isTauriOffice, nativeAppVersion, nativeRename, nativePickDocument, Filesystem, Directory, type AiSnapshot } from '../runtime/native-files'
import { openExternalUrl } from '../runtime/electron'

const APP_BY_EXT: Record<string, string> = {
  docx: 'docs', dotx: 'docs', doc: 'docs', dot: 'docs', odt: 'docs', ott: 'docs', hwp: 'hwp', hwpx: 'hwp',
  pptx: 'slides', potx: 'slides', ppt: 'slides', odp: 'slides', otp: 'slides',
  xlsx: 'sheets', xlsm: 'sheets', xls: 'sheets', ods: 'sheets', ots: 'sheets', csv: 'sheets', tsv: 'sheets', pdf: 'pdf',
  // Apple iWork: converted to an editable copy first (see openPath)
  pages: 'docs', key: 'slides', numbers: 'sheets',
}
const IWORK_LABEL: Record<string, string> = { pages: 'Pages', key: 'Keynote', numbers: 'Numbers' }
const tagLabel = (n: string) => IWORK_LABEL[ext(n)] ?? APP_LABEL[appFor(n)][lang() === 'ko' ? 0 : 1]
const APP_LABEL: Record<string, [string, string]> = { hwp: ['한글', 'Hangul'], docs: ['문서', 'Docs'], slides: ['슬라이드', 'Slides'], sheets: ['스프레드시트', 'Sheets'], pdf: ['PDF', 'PDF'] }
const ext = (n: string) => n.split('.').pop()!.toLowerCase()
const appFor = (n: string) => APP_BY_EXT[ext(n)]

// ---- settings store (same key the in-tab apps read: shim/runtime/shell-ipc.ts) ----
const SKEY = 'alleditor.settings'
const sLoad = (): Record<string, any> => { try { return JSON.parse(localStorage.getItem(SKEY) || '{}') } catch { return {} } }
const sGet = (k: string, d: any) => (sLoad()[k] === undefined ? d : sLoad()[k])
const sSet = (k: string, v: any) => { const s = sLoad(); s[k] = v; localStorage.setItem(SKEY, JSON.stringify(s)) }
const lang = () => sGet('language', 'ko') as string
const t = (k: string) => tr(lang(), k)

// ---- tabs ----
interface Tab { id: string; kind: 'home' | 'settings' | 'app'; app?: string; path?: string; title: string }
const TABS_KEY = 'alleditor.tabs'
let tabs: Tab[] = []
let active = ''
const frames = new Map<string, HTMLIFrameElement>()
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e }

function saveTabs() {
  try { localStorage.setItem(TABS_KEY, JSON.stringify({ active, tabs: tabs.filter((x) => x.kind === 'app').map(({ app, path, title }) => ({ app, path, title })) })) } catch {}
}
function addTab(tab: Omit<Tab, 'id'>, focus = true): Tab {
  const existing = tabs.find((x) => x.kind === tab.kind && x.app === tab.app && x.path && x.path === tab.path) ?? (tab.kind !== 'app' ? tabs.find((x) => x.kind === tab.kind) : undefined)
  if (existing) { if (focus) activate(existing.id); return existing }
  const t2: Tab = { ...tab, id: 't' + Math.random().toString(36).slice(2, 8) }
  tabs.push(t2)
  if (t2.kind === 'app') {
    const f = el('iframe', 'pane')
    f.src = `./${t2.app}/index.html` + (t2.path ? `?open=${encodeURIComponent(t2.path)}` : '')
    f.setAttribute('allow', 'clipboard-read; clipboard-write')
    f.hidden = true
    $('panes').append(f); frames.set(t2.id, f)
  }
  if (focus) activate(t2.id); else renderBar()
  return t2
}
async function closeTab(id: string) {
  const tab = tabs.find((x) => x.id === id); if (!tab || tab.kind === 'home') return
  const f = frames.get(id)
  try { await (f?.contentWindow as any)?.__aeFlush?.() } catch {}
  f?.remove(); frames.delete(id)
  const i = tabs.indexOf(tab); tabs.splice(i, 1)
  if (active === id) activate(tabs[Math.max(0, i - 1)].id); else { renderBar(); saveTabs() }
}
function activate(id: string) {
  active = id
  for (const [fid, f] of frames) f.hidden = fid !== id
  const tab = tabs.find((x) => x.id === id)!
  $('homePane').hidden = tab.kind !== 'home'
  $('settingsPane').hidden = tab.kind !== 'settings'
  if (tab.kind === 'home') renderHome()
  if (tab.kind === 'settings') renderSettings()
  renderBar(); saveTabs()
}
function tabLabel(x: Tab) { return x.kind === 'home' ? t('home') : x.kind === 'settings' ? t('settings') : x.title }
// Inside the Tauri app the suite is the app's home, in a full-screen iframe (office://localhost/index.html?embed=1);
// the host can send { type: 'ae-office', action: 'new', app }.
const EMBED = (() => { try { return new URLSearchParams(location.search).has('embed') && window.parent !== window } catch { return false } })()
const toHost = (msg: object) => { try { window.parent.postMessage(msg, '*') } catch {} }
function renderBar() {
  const bar = $('tabs'); bar.textContent = ''
  for (const x of tabs) {
    const b = el('div', 'tab' + (x.id === active ? ' on' : '') + (x.app ? ' ' + x.app : ''))
    const lab = el('button', 'tl', tabLabel(x)); lab.onclick = () => (x.id === active && x.kind === 'app' ? void renameTab(x) : activate(x.id)); b.append(lab)
    if (x.id === active && x.kind === 'app') lab.title = lang() === 'ko' ? '눌러서 이름 바꾸기' : 'Tap to rename'
    if (x.kind !== 'home') { const c = el('button', 'tx', '✕'); c.setAttribute('aria-label', t('closeTab')); c.onclick = () => void closeTab(x.id); b.append(c) }
    bar.append(b)
  }
  const cur = tabs.find((x) => x.id === active)
  if (cur?.kind === 'app') {
    const send = el('button', 'send', sendLabel(cur)); send.setAttribute('aria-label', sendLabel(cur))
    send.onclick = () => void sendDoc(cur)
    bar.append(send)
  }
  const gear = el('button', 'gear' + (tabs.find((x) => x.id === active)?.kind === 'settings' ? ' on' : ''), '⚙'); gear.setAttribute('aria-label', t('settings'))
  gear.onclick = () => addTab({ kind: 'settings', title: t('settings') })
  bar.append(gear)
  bar.querySelector('.tab.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
}

// ---- rename: tap the active tab's name ----
// The tab's document is renamed in Documents and the tab reopens it under the new name (unsaved changes must be
// saved first: the editors keep their own copy of the path).
/** ask for a new name and rename the file (extension kept); the new path, or null when nothing changed */
async function renamePath(path: string, before?: () => Promise<void>): Promise<string | null> {
  const ko = lang() === 'ko'
  const dir = path.slice(0, path.lastIndexOf('/')), file = path.slice(path.lastIndexOf('/') + 1)
  const dot = file.lastIndexOf('.'), stem = dot > 0 ? file.slice(0, dot) : file, extn = dot > 0 ? file.slice(dot) : ''
  const input = prompt(ko ? `새 이름 (${extn} 은 그대로 둡니다)\n저장하지 않은 변경이 있으면 취소하고 먼저 저장하세요.` : `New name (${extn} is kept)\nCancel and save first if there are unsaved changes.`, stem)
  if (input === null) return null
  const name = input.trim().replace(/[\\/:*?"<>|]/g, '_').replace(new RegExp(extn.replace('.', '\\.') + '$', 'i'), '')
  if (!name || name === stem) return null
  const to = `${dir}/${name}${extn}`
  if (fs.existsSync(to)) { alert(ko ? '같은 이름의 파일이 이미 있습니다.' : 'A file with that name already exists.'); return null }
  try {
    try { await before?.() } catch {}
    await flush()
    if (isTauriOffice()) await nativeRename(path, to)
    else { await ensureLoaded(path); fs.renameSync(path, to); await flush() }
  } catch (e: any) { alert((ko ? '이름을 바꾸지 못했습니다: ' : 'Could not rename: ') + (e?.message ?? e)); return null }
  try { if (fs.existsSync(path)) fs.renameSync(path, to) } catch {} // keep this page's listing in step
  return to
}
/** an open tab follows its file to the new name */
function retarget(x: Tab, to: string) {
  x.path = to; x.title = to.slice(to.lastIndexOf('/') + 1)
  const f = frames.get(x.id)
  if (f) f.src = `./${x.app}/index.html?open=${encodeURIComponent(to)}`
}
const tabPath = (x: Tab): string | null => { const w = frames.get(x.id)?.contentWindow as any; try { return w?.__aeDocPath?.() ?? x.path ?? null } catch { return x.path ?? null } }
async function renameTab(x: Tab) {
  const ko = lang() === 'ko'
  const w = frames.get(x.id)?.contentWindow as any
  const path = tabPath(x)
  if (!path) { alert(ko ? '새 문서는 먼저 저장하세요 (파일 › 저장). 저장할 때 이름을 정할 수 있습니다.' : 'Save the new document first (File › Save); you can name it there.'); return }
  const to = await renamePath(path, async () => { await w?.__aeFlush?.() })
  if (!to) return
  retarget(x, to)
  renderBar(); saveTabs()
}
// a tab follows its document: once a new document is saved (or saved under another name), the tab shows the file
addEventListener('scroll', () => { if (scrollY || scrollX) scrollTo(0, 0) }, { passive: true }) // keyboard: the page never scrolls
setInterval(() => {
  let changed = false
  for (const x of tabs) {
    if (x.kind !== 'app') continue
    const p = tabPath(x)
    if (p && p !== x.path) { x.path = p; x.title = p.slice(p.lastIndexOf('/') + 1); changed = true }
  }
  if (changed) { renderBar(); saveTabs(); if (tabs.find((x) => x.id === active)?.kind === 'home') renderHome() }
}, 1500)
/** rename from the home's recent list; a tab that has the file open follows it */
async function renameListed(path: string) {
  const open = tabs.filter((x) => x.kind === 'app' && tabPath(x) === path)
  const to = await renamePath(path, async () => { for (const x of open) await (frames.get(x.id)?.contentWindow as any)?.__aeFlush?.() })
  if (!to) return
  for (const x of open) retarget(x, to)
  if (open.length) { renderBar(); saveTabs() }
  renderHome()
}

// ---- send to Pages / Keynote / Numbers (iOS share sheet) ----
// The tab's document as last saved: Pages / Keynote / Numbers open docx / pptx / xlsx and can keep it in Apple format.
const SEND_TARGET: Record<string, [string, string]> = { docs: ['Pages', 'Pages'], slides: ['Keynote', 'Keynote'], sheets: ['Numbers', 'Numbers'] }
const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf', csv: 'text/csv', hwp: 'application/x-hwp', hwpx: 'application/hwp+zip',
}
function sendLabel(x: Tab) {
  const target = SEND_TARGET[x.app ?? '']
  if (lang() === 'ko') return target ? `${target[0]}로 보내기` : '보내기'
  return target ? `Send to ${target[1]}` : 'Send'
}
async function sendDoc(x: Tab) {
  const f = frames.get(x.id)
  const w = f?.contentWindow as any
  try { await w?.__aeFlush?.() } catch {}
  const path: string | null = w?.__aeDocPath?.() ?? x.path ?? null
  if (!path) {
    alert(lang() === 'ko' ? '먼저 문서를 저장하세요 (파일 › 저장). 저장된 내용이 보내집니다.' : 'Save the document first (File › Save). The saved version is sent.')
    return
  }
  try {
    const bytes: Uint8Array = w?.__aeReadFile ? w.__aeReadFile(path) : new Uint8Array(fs.readFileSync(path))
    const name = path.split('/').pop()!
    await nativeShare(name, MIME[ext(name)] ?? 'application/octet-stream', bytes)
  } catch (e: any) {
    alert((lang() === 'ko' ? '보내지 못했습니다: ' : 'Could not send: ') + (e?.message ?? e))
  }
}

// ---- files ----
// credit line (same text in every language, user-mandated)
const CREDIT_LINE1 = 'AllEditor (iOS / iPadOS) — Developed by JaiSung NOH MD 2026'
export const CREDIT = CREDIT_LINE1 + '\nThis app is built on the open source of 이음오피스 (IeumOffice) by 박준일 (Jun-il Park), which is itself based on GenOffice by Genspark AI / Mainfunc, Inc. (Apache License 2.0)'
let creditVersion = ''
const credit = () => creditVersion ? CREDIT.replace(CREDIT_LINE1, `${CREDIT_LINE1}, ${creditVersion}`) : CREDIT
/** credit paragraph; the version is filled in once the native side answers */
const creditEl = () => {
  const p = el('p', 'credit', credit())
  if (!creditVersion && isTauriOffice()) void nativeAppVersion().then((v) => { creditVersion = `Version ${v.version}, Build ${v.build}`; p.textContent = credit() }, () => {})
  return p
}
const busy = new Set<string>()
async function openPath(path: string) {
  unhide(path.slice(path.lastIndexOf('/') + 1))
  const name = path.split('/').pop()!, app = appFor(name)
  if (!app) { alert(`${t('unsupported')}: ${name}`); return }
  const kind = IWORK_EXT[ext(name)]
  if (!kind) { addTab({ kind: 'app', app, path, title: name }); return }
  // iWork file: open its editable copy (made once, then independent of the original)
  const stem = path.replace(/\.[^.]+$/, '')
  const outExt = kind === 'pages' ? 'docx' : kind === 'keynote' ? 'pptx' : 'xlsx'
  const copy = `${stem}.${outExt}`
  if (fs.existsSync(copy)) { openPath(copy); return }
  if (busy.has(path)) return
  if (!confirm(`${name}\n\n${t('iworkConfirm')}`)) return
  busy.add(path)
  const wait = el('div', 'toast', t('converting')); document.body.append(wait)
  try {
    await ensureLoaded(path) // big files are only listed until needed
    const b = fs.readFileSync(path) as Uint8Array
    const r = await convertIwork(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, kind)
    fs.writeFileSync(copy, r.bytes); await flush()
    wait.remove(); openPath(copy)
  } catch (e: any) { wait.remove(); alert(`${t('convertFailed')}: ${e?.message ?? e}`) }
  finally { busy.delete(path) }
}
function newBlank(app: string) { addTab({ kind: 'app', app, title: APP_LABEL[app][lang() === 'ko' ? 0 : 1] + ' ' + (tabs.filter((x) => x.app === app).length + 1) }) }
const uniq = (name: string) => {
  const dot = name.lastIndexOf('.'); const stem = dot > 0 ? name.slice(0, dot) : name, e = dot > 0 ? name.slice(dot) : ''
  let p = `${DOCS_ROOT}/${name}`, i = 1
  while (fs.existsSync(p)) p = `${DOCS_ROOT}/${stem} ${i++}${e}`
  return p
}
async function importFile(f: File) {
  const name = f.name.replace(/[\\/:*?"<>|]/g, '_')
  if (!appFor(name)) { alert(`${t('unsupported')}: ${name}`); return }
  const p = uniq(name)
  fs.writeFileSync(p, new Uint8Array(await f.arrayBuffer()))
  await flush()
  void openPath(p)
}
const fmt = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')

// Home (the one home of the app; same look as the former 이음오피스 home): AllEditor header, 새로 만들기 cards,
// 파일 열기, 최근 문서 (Documents of the app = Files › AllEditor), credit.
const BADGE: Record<string, [string, string]> = { hwp: ['한', '#1d9bd1'], docs: ['W', '#2b6cd4'], slides: ['P', '#d24726'], sheets: ['X', '#1e7145'], pdf: ['PDF', '#e03a3e'] }
const IWORK_BADGE: Record<string, [string, string]> = { pages: ['Pg', '#f39c12'], key: ['K', '#2980b9'], numbers: ['N', '#27ae60'] }
const TYPE_NAME: Record<string, string> = { docs: 'Word', slides: 'PowerPoint', sheets: 'Excel', pdf: 'PDF' }
const typeName = (n: string) => IWORK_LABEL[ext(n)] ?? (appFor(n) === 'hwp' ? (lang() === 'ko' ? '한글' : 'Hangul') : TYPE_NAME[appFor(n)] ?? '')
const badgeFor = (n: string): [string, string] => IWORK_BADGE[ext(n)] ?? BADGE[appFor(n)] ?? ['?', '#8e8e93']
function badge([label, color]: [string, string], cls = 'badge') { const b = el('span', cls, label); b.style.background = color; return b }
const ago = (ms: number) => {
  if (!ms) return ''
  const d = new Date(ms), now = new Date()
  const same = d.toDateString() === now.toDateString()
  return same ? d.toLocaleTimeString(lang() === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(lang() === 'ko' ? 'ko-KR' : 'en-US')
}
/** 파일 열기: in the app, the system picker opens at the AllEditor folder (iCloud Drive › AllEditor); a file from
 * elsewhere is copied into it. In a browser, the page's own file input. */
async function openPicked() {
  if (!isTauriOffice()) { $<HTMLInputElement>('picker').click(); return }
  try {
    const r = await nativePickDocument()
    if (r.canceled || !r.name) return
    const path = `${DOCS_ROOT}/${r.name}`
    if (!appFor(r.name)) { alert(`${t('unsupported')}: ${r.name}`); return }
    if (!fs.existsSync(path)) {
      // this page's file list was loaded at start: bring the picked (or copied) file in
      const { data } = await Filesystem.readFile({ path: r.name, directory: Directory.Documents })
      const bin = atob(data as string); const u = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
      fs.writeFileSync(path, u)
    }
    void openPath(path)
    if (tabs.find((x) => x.id === active)?.kind === 'home') renderHome()
  } catch (e: any) {
    // an older app build without the picker: fall back to the page's file input
    if (/unknown plugin|not available/i.test(String(e?.message ?? e))) $<HTMLInputElement>('picker').click()
    else alert((lang() === 'ko' ? '파일을 열지 못했습니다: ' : 'Could not open the file: ') + (e?.message ?? e))
  }
}
// ---- 최근 문서 ----
// The list is the AllEditor folder, newest first. ✕ only takes a document off this list (the file stays in the
// folder); it comes back when the document is opened or changed again.
type Row = { n: string; size: number; m: number }
const HIDDEN_KEY = 'alleditor.recentHidden'
const readHidden = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '{}') } catch { return {} } }
const writeHidden = (h: Record<string, number>) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(h)) } catch {} }
function unhide(name: string) { const h = readHidden(); if (name in h) { delete h[name]; writeHidden(h) } }
function memRows(): Row[] {
  let names: string[] = []
  try { names = fs.readdirSync(DOCS_ROOT).map(String).filter((n: string) => !n.startsWith('.') && appFor(n)) } catch {}
  return names.map((n) => { const st = fs.statSync(`${DOCS_ROOT}/${n}`); return { n, size: st.size as number, m: Number(st.mtimeMs ?? 0) } })
}
async function nativeRows(): Promise<Row[] | null> {
  if (!isTauriOffice()) return null
  try {
    const { files } = await Filesystem.readdir({ path: '', directory: Directory.Documents })
    return (files as any[]).filter((f) => f.type !== 'directory' && !String(f.name).startsWith('.') && appFor(String(f.name)))
      .map((f) => ({ n: String(f.name), size: Number(f.size ?? 0), m: Number(f.mtime ?? 0) }))
  } catch { return null }
}
// grouped by kind (한글 · Word · PowerPoint · Excel · PDF · Pages · Keynote · Numbers), newest first in each group,
// or one list newest first; the choice is remembered
const RECENT_VIEW_KEY = 'alleditor.recentView'
const recentView = (): 'kind' | 'time' => { try { return localStorage.getItem(RECENT_VIEW_KEY) === 'time' ? 'time' : 'kind' } catch { return 'kind' } }
const KIND_ORDER = ['hwp', 'docs', 'slides', 'sheets', 'pdf', 'pages', 'key', 'numbers']
const kindOf = (n: string) => (IWORK_LABEL[ext(n)] ? ext(n) : appFor(n))
function fillRecent(list: HTMLElement, all: Row[]) {
  const ko = lang() === 'ko'
  const hidden = readHidden()
  const rows = all.filter((r) => !(r.n in hidden) || r.m > hidden[r.n]).sort((a, b) => b.m - a.m)
  list.textContent = ''
  if (!rows.length) {
    const box = el('div', 'files none'); box.append(el('p', 'empty', ko ? '최근 문서가 없습니다. 새로 만들거나 파일을 여세요.' : 'No recent documents. Create one or open a file.'))
    list.append(box); return
  }
  const groups: Array<[string, Row[]]> = recentView() === 'time'
    ? [['', rows]]
    : KIND_ORDER.map((k) => [k, rows.filter((r) => kindOf(r.n) === k)] as [string, Row[]]).filter(([, g]) => g.length)
  for (const [kind, items] of groups) {
    if (kind) {
      const head = el('div', 'kind-head')
      const sample = items[0].n
      head.append(badge(badgeFor(sample), 'badge small'), el('span', 'kind-name', typeName(sample)), el('span', 'kind-count', String(items.length)))
      list.append(head)
    }
    const box = el('div', 'files'); list.append(box)
    for (const r of items) box.append(recentRow(r, () => fillRecent(list, all)))
  }
}
function recentRow(r: Row, redraw: () => void): HTMLElement {
  const ko = lang() === 'ko'
  const row = el('div', 'row'); const b = el('button', 'file')
  const meta = el('span', 'meta'); meta.append(el('span', 'nm', r.n), el('span', 'sz', [typeName(r.n), fmt(r.size), ago(r.m)].filter(Boolean).join(' · ')))
  b.append(badge(badgeFor(r.n)), meta); b.onclick = () => openPath(`${DOCS_ROOT}/${r.n}`)
  const rn = el('button', 'ren'); rn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
  rn.setAttribute('aria-label', ko ? '이름 바꾸기' : 'Rename'); rn.title = rn.getAttribute('aria-label')!
  rn.onclick = () => void renameListed(`${DOCS_ROOT}/${r.n}`)
  const d = el('button', 'del', '✕')
  d.setAttribute('aria-label', ko ? '최근 문서에서 빼기' : 'Remove from recent'); d.title = d.getAttribute('aria-label')!
  d.onclick = () => {
    if (!confirm(ko ? `${r.n}\n\n최근 문서 목록에서 뺄까요?\n파일은 AllEditor 폴더에 그대로 남습니다.` : `${r.n}\n\nRemove from the recent list?\nThe file stays in the AllEditor folder.`)) return
    const h = readHidden(); h[r.n] = Math.max(r.m, Date.now()); writeHidden(h)
    redraw()
  }
  row.append(b, rn, d)
  return row
}

function renderHome() {
  const ko = lang() === 'ko'
  const root = $('homePane'); root.textContent = ''
  const wrap = el('main', 'home'); root.append(wrap)
  const head = el('header', 'brand')
  const icon = el('img', 'brand-icon') as HTMLImageElement; icon.src = './alleditor-icon.svg'; icon.alt = ''
  head.append(icon, el('h1', '', 'AllEditor')); wrap.append(head)

  wrap.append(el('h2', '', t('newSection')))
  const grid = el('div', 'cards')
  const NEW: Array<[string, string, string]> = [
    ['hwp', ko ? '새 한글 문서' : 'New Hangul document', '.hwpx'], ['docs', ko ? '새 Word 문서' : 'New Word document', '.docx'],
    ['slides', ko ? '새 PowerPoint' : 'New PowerPoint', '.pptx'], ['sheets', ko ? '새 Excel 시트' : 'New Excel sheet', '.xlsx'],
  ]
  for (const [app, title, sub] of NEW) {
    const b = el('button', 'newcard'); b.dataset.app = app
    b.append(badge(BADGE[app], 'badge big'), el('span', 'nc-title', title), el('span', 'nc-sub', sub))
    b.onclick = () => newBlank(app); grid.append(b)
  }
  wrap.append(grid)

  const open = el('button', 'opencard')
  const ic = el('span', 'oc-icon')
  ic.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>'
  const txt = el('span', 'oc-text'); txt.append(el('span', 'oc-title', ko ? '파일 열기' : 'Open a file'), el('span', 'oc-sub', ko ? '한글 · Word · PowerPoint · Excel · PDF · Pages · Keynote · Numbers' : 'Hangul · Word · PowerPoint · Excel · PDF · Pages · Keynote · Numbers'))
  open.append(ic, txt, el('span', 'oc-chev', '›'))
  open.onclick = () => void openPicked()
  wrap.append(open)

  const rhead = el('div', 'recent-head')
  const seg = el('div', 'seg')
  const list = el('div', 'recent')
  let last: Row[] = memRows()
  const draw = (rows: Row[]) => { last = rows; fillRecent(list, rows) }
  for (const [v, label] of [['kind', ko ? '종류별' : 'By type'], ['time', ko ? '최신순' : 'Newest']] as const) {
    const btn = el('button', recentView() === v ? 'on' : '', label)
    btn.onclick = () => { try { localStorage.setItem(RECENT_VIEW_KEY, v) } catch {}; for (const x of seg.children) x.classList.toggle('on', x === btn); fillRecent(list, last) }
    seg.append(btn)
  }
  rhead.append(el('h2', '', ko ? '최근 문서' : 'Recent documents'), seg)
  wrap.append(rhead, list)
  draw(last)
  // documents saved by an editor tab (each tab is its own page) or added in the Files app: ask the device
  void nativeRows().then((rows) => { if (rows && list.isConnected) draw(rows) })
  wrap.append(creditEl())
}

// ---- settings ----
const AI_FILE = `${USER_ROOT}/ai-settings.json`
function readAi(): any { try { return JSON.parse(String(fs.readFileSync(AI_FILE, 'utf8'))) } catch { return {} } }
function field(label: string, control: HTMLElement) { const l = el('label', 'fld'); l.append(el('span', 'fl', label), control); return l }
function select(options: Array<[string, string]>, value: string, onchange: (v: string) => void) {
  const s = el('select'); for (const [v, l] of options) { const o = el('option', '', l); o.value = v; s.append(o) }
  s.value = value; s.onchange = () => onchange(s.value); return s
}
function reloadFrames() { for (const f of frames.values()) try { f.contentWindow?.location.reload() } catch {} }

function renderSettings() {
  const root = $('settingsPane'); root.textContent = ''
  const wrap = el('main'); root.append(wrap)
  wrap.append(el('h1', '', t('settings')))
  const toast = (m: string) => { const x = el('div', 'toast', m); document.body.append(x); setTimeout(() => x.remove(), 1600) }
  const changed = (rebuild = false) => { toast(t('applied')); if (rebuild) { reloadFrames(); renderBar(); renderSettings() } }

  wrap.append(el('h2', '', t('general')))
  const g = el('div', 'group'); wrap.append(g)
  g.append(field(t('language'), select(LANGS, lang(), (v) => { sSet('language', v); changed(true) })))
  g.append(field(t('theme'), select([['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]], sGet('theme', 'system'), (v) => { sSet('theme', v); applyTheme(); changed(true) })))
  // 한글 editor menus: the Word-style ribbon (default) or 한글's own menu bar; applies to 한글 documents opened next
  g.append(field(lang() === 'ko' ? '한글 메뉴' : 'Hangul menus', select([['ribbon', lang() === 'ko' ? 'Word식 리본' : 'Word-style ribbon'], ['classic', lang() === 'ko' ? '한글식 메뉴' : 'Hangul menu bar']], sGet('hwpMenu', 'ribbon'), (v) => {
    sSet('hwpMenu', v); toast(lang() === 'ko' ? '다음에 여는 한글 문서부터 적용됩니다' : 'Applies to the next Hangul document you open')
  })))
  g.append(field(t('docTheme'), select([['follow', t('follow')], ['light', t('themeLight')], ['dark', t('themeDark')]], sGet('documentTheme', 'follow'), (v) => { sSet('documentTheme', v); changed(true) })))
  const mu = sGet('measurementUnit', { unit: 'cm', explicit: false })
  g.append(field(t('unit'), select([['cm', 'cm'], ['in', 'in'], ['mm', 'mm'], ['pt', 'pt'], ['pi', 'pica']], mu.unit, (v) => { sSet('measurementUnit', { unit: v, explicit: true }); changed(true) })))
  g.append(field(t('autosave'), select([['1', t('on')], ['0', t('off')]], sGet('autoSave', { on: true }).on ? '1' : '0', (v) => { sSet('autoSave', { on: v === '1', updatedAt: Date.now() }); changed(true) })))
  const au = el('input'); au.type = 'text'; au.value = sGet('authorName', ''); au.onchange = () => { sSet('authorName', au.value.trim()); changed(false) }
  g.append(field(t('author'), au))
  wrap.append(el('p', 'hint', t('reloadHint')))

  renderAiConnect(wrap, toast)

  wrap.append(el('h2', '', t('printers')))
  const pr = el('div', 'group'); wrap.append(pr)
  const drawPrinters = () => {
    pr.textContent = ''
    for (const p of getPrinters()) {
      const row = el('div', 'fld')
      row.append(el('span', 'fl', `${p.name}`), el('span', 'nm', `${p.host} · ${p.protocol.toUpperCase()}`))
      const tb = el('button', 'mini', t('test')); tb.onclick = async () => {
        try { await sendToPrinter(testPdf(`${p.name} ${p.host}`), { deviceName: 'ip:' + p.id }, 'AllEditor test'); toast(t('printOk')) } catch (e: any) { alert(`${t('printFail')}: ${e?.message ?? e}`) }
      }
      const rb = el('button', 'mini', '✕'); rb.setAttribute('aria-label', t('remove')); rb.onclick = () => { setPrinters(getPrinters().filter((x) => x.id !== p.id)); drawPrinters() }
      row.append(tb, rb); pr.append(row)
    }
    const nm = el('input'); nm.type = 'text'; nm.placeholder = t('printerName')
    const ho = el('input'); ho.type = 'text'; ho.placeholder = '192.168.0.10'; ho.inputMode = 'decimal'; ho.autocapitalize = 'off'
    const pro = select([['auto', t('protoAuto')], ['ipp', t('protoIpp')], ['raw', t('protoRaw')]], 'auto', () => {})
    pr.append(field(t('printerName'), nm), field(t('printerHost'), ho), field(t('printerProto'), pro))
    const add = el('button', 'primary', t('addPrinter'))
    add.onclick = () => {
      const host = ho.value.trim(); if (!/^[\w.\-:]+$/.test(host)) { alert(t('printerHost')); return }
      const cfg: PrinterCfg = { id: Math.random().toString(36).slice(2, 8), name: nm.value.trim() || host, host, protocol: pro.value as PrinterCfg['protocol'] }
      setPrinters([...getPrinters(), cfg]); drawPrinters()
    }
    const ios = el('button', 'primary alt', t('iosPrint'))
    ios.onclick = async () => { try { await sendToPrinter(testPdf('iOS print dialog'), {}, 'AllEditor test') } catch (e: any) { alert(`${t('printFail')}: ${e?.message ?? e}`) } }
    pr.append(add, ios)
  }
  drawPrinters()
  wrap.append(el('p', 'hint', t('printerHint')))

  const ver = el('p', 'hint ver')
  wrap.append(el('h2', '', t('about')), ver, el('p', 'hint', t('aboutText')), creditEl())
  if (isTauriOffice()) void nativeAppVersion().then((v) => { ver.textContent = lang() === 'ko' ? `AllEditor 버전 ${v.version} (빌드 ${v.build})` : `AllEditor version ${v.version} (build ${v.build})` }, () => {})
}

// ---- AI 연결 (iPad): API-key providers only — the desktop subscriptions (Claude Code, Codex, ChatGPT sign-in)
// run a PC program or need the desktop app's own sign-in, so they are not offered here.
interface ConnectCard { id: string; name: string; sub: [string, string]; keyUrl: string; free?: boolean }
const CONNECT_CARDS: ConnectCard[] = [
  { id: 'gemini', name: 'Google Gemini', sub: ['무료 키로 시작할 수 있습니다 (하루 한도 있음)', 'Free key available (daily limit)'], keyUrl: 'https://aistudio.google.com/apikey', free: true },
  { id: 'openai', name: 'ChatGPT (OpenAI API)', sub: ['OpenAI API 키 — 쓴 만큼 요금이 나갑니다', 'OpenAI API key — pay as you go'], keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Claude (Anthropic API)', sub: ['Anthropic API 키 — 쓴 만큼 요금이 나갑니다', 'Anthropic API key — pay as you go'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openrouter', name: 'OpenRouter', sub: ['여러 회사 모델을 키 하나로, 무료 모델도 있습니다', 'Many models with one key, some free'], keyUrl: 'https://openrouter.ai/keys', free: true },
]
const NOT_ON_IOS = new Set(['claude-code', 'codex', 'chatgpt', 'genspark', 'auto'])
const ko2 = (k: string, e: string) => (lang() === 'ko' ? k : e)

/** a cheap request that only succeeds with a valid key */
async function checkKey(id: string, key: string, baseUrl?: string): Promise<string | null> {
  const f = (globalThis as any).fetch as typeof fetch
  let r: Response
  try {
    if (id === 'gemini') r = await f(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`)
    else if (id === 'anthropic') r = await f('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })
    else if (id === 'openrouter') r = await f('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } })
    else if (id === 'openai') r = await f('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } })
    else if (baseUrl) r = await f(baseUrl.replace(/\/$/, '') + '/models', { headers: { authorization: `Bearer ${key}` } })
    else return null
  } catch (e: any) { return ko2('네트워크 오류: ', 'Network error: ') + (e?.message ?? e) }
  if (r.ok) return null
  if (r.status === 401 || r.status === 403 || r.status === 400) return ko2('키가 맞지 않습니다', 'The key was not accepted') + ` (HTTP ${r.status})`
  return `HTTP ${r.status}`
}

/** where the AI setting lives: the app's one store (Rust, keys sealed) on the device, the settings file elsewhere */
interface AiStore {
  provider: string
  cfg(id: string): { hasKey: boolean; key: string; model: string; models: string[] }
  save(provider: string, key: string | undefined, model: string, baseUrl?: string): Promise<void>
}
async function loadAiStore(): Promise<AiStore> {
  if (isTauriOffice()) {
    let snap: AiSnapshot = await nativeAi.get()
    const st: AiStore = {
      provider: snap.selectedProvider,
      cfg: (id) => ({ hasKey: !!snap.configuredProviders[id]?.hasKey, key: '', model: snap.modelByProvider[id] ?? '', models: snap.configuredProviders[id]?.models ?? [] }),
      async save(provider, key, model) {
        snap = await nativeAi.set({ provider, ...(key ? { apiKey: key } : {}), ...(model ? { model } : {}) })
        st.provider = snap.selectedProvider
        // every open office tab rebuilds its in-memory settings from the store
        for (const f of frames.values()) { try { await (f.contentWindow as any)?.__aeAiRefresh?.() } catch {} }
      },
    }
    return st
  }
  const stored = readAi()
  const def = defaultAiSettings()
  const cur = { ...def, ...stored, providers: { ...def.providers, ...(stored.providers ?? {}) } } as any
  const st: AiStore = {
    provider: cur.provider,
    cfg: (id) => { const c = cur.providers[id] ?? {}; return { hasKey: !!c.apiKey, key: c.apiKey ?? '', model: c.model ?? '', models: c.models ?? [] } },
    async save(provider, key, model, baseUrl) {
      const prev = cur.providers[provider] ?? {}
      const next: any = { ...cur, provider, providers: { ...cur.providers, [provider]: { ...prev, ...(key ? { apiKey: key } : {}), model, ...(baseUrl !== undefined ? { baseUrl } : {}) } } }
      const clean = sanitizeAiSettings(next) ?? next
      fs.mkdirSync(USER_ROOT, { recursive: true }); fs.writeFileSync(AI_FILE, JSON.stringify(clean, null, 2)); await flush()
      Object.assign(cur, clean); st.provider = provider; reloadFrames()
    },
  }
  return st
}

function renderAiConnect(wrap: HTMLElement, toast: (m: string) => void) {
  const h = el('h2', '', ko2('AI 연결', 'AI connection')); h.id = 'ai'; wrap.append(h)
  const box = el('div', 'group'); wrap.append(box)
  box.append(el('p', 'hint', ko2('불러오는 중…', 'Loading…')))
  const metas = (AI_PROVIDERS as any[]).filter((m) => !m.needsCliPath && !NOT_ON_IOS.has(m.id))
  void loadAiStore().then((store) => {
    let selected: string = NOT_ON_IOS.has(store.provider) || !metas.some((m) => m.id === store.provider) ? 'gemini' : store.provider
    const status = el('p', 'hint')
    const draw = () => {
      box.textContent = ''
      const curCfg = store.cfg(store.provider)
      const on = !NOT_ON_IOS.has(store.provider) && curCfg.hasKey
      const meta = metas.find((m) => m.id === store.provider)
      status.textContent = on ? `● ${ko2('연결됨', 'Connected')}: ${meta?.label ?? store.provider} · ${curCfg.model || meta?.defaultModel || ''}` : `○ ${ko2('아직 연결되지 않았습니다. 아래에서 하나를 골라 키를 넣으세요.', 'Not connected yet. Pick one below and enter its key.')}`
      status.className = 'hint ai-status' + (on ? ' on' : '')
      box.append(status)
      const cards = el('div', 'ai-cards'); box.append(cards)
      const ids = CONNECT_CARDS.map((c) => c.id)
      const extra = metas.filter((m) => !ids.includes(m.id))
      for (const c of CONNECT_CARDS) {
        const b = el('button', 'ai-card' + (selected === c.id ? ' sel' : '') + (store.provider === c.id && on ? ' cur' : ''))
        b.append(el('b', '', c.name), el('span', '', c.sub[lang() === 'ko' ? 0 : 1]))
        b.onclick = () => { selected = c.id; draw() }
        cards.append(b)
      }
      const more = el('button', 'ai-card' + (!ids.includes(selected) ? ' sel' : ''))
      more.append(el('b', '', ko2('다른 제공자', 'Other providers')), el('span', '', ko2('DeepSeek, Mistral, xAI …', 'DeepSeek, Mistral, xAI …')))
      more.onclick = () => { selected = ids.includes(selected) ? (extra[0]?.id ?? 'gemini') : selected; draw() }
      cards.append(more)

      const form = el('div', 'ai-form'); box.append(form)
      if (!ids.includes(selected)) form.append(field(t('provider'), select(extra.map((m) => [m.id, m.label]), selected, (v) => { selected = v; draw() })))
      const meta2: any = metas.find((m) => m.id === selected) ?? {}
      const card = CONNECT_CARDS.find((c) => c.id === selected)
      const pcfg = store.cfg(selected)
      const key = el('input'); key.type = 'password'; key.autocomplete = 'off'; key.spellcheck = false; key.value = pcfg.key
      key.placeholder = pcfg.hasKey && !pcfg.key ? ko2('저장된 키가 있습니다 — 바꾸려면 새 키 입력', 'A key is saved — type a new one to replace it') : (meta2.keyPlaceholder ?? '')
      const dl = el('datalist'); dl.id = 'ai-models'; for (const m of [...pcfg.models, ...(meta2.models ?? [])]) { const o = el('option'); o.value = typeof m === 'string' ? m : (m as any).id; dl.append(o) }
      const model = el('input'); model.type = 'text'; model.setAttribute('list', 'ai-models'); model.value = pcfg.model || meta2.defaultModel || ''
      form.append(field(t('apiKey'), key), field(t('model'), model), dl)
      let base: HTMLInputElement | null = null
      if (meta2.needsBaseUrl && !isTauriOffice()) { base = el('input'); base.type = 'url'; base.placeholder = 'https://…/v1'; form.append(field(t('baseUrl'), base)) }
      const row = el('div', 'ai-actions')
      if (card) { const get = el('button', 'ai-link', ko2('키 만들기 ↗', 'Get a key ↗')); get.onclick = () => { void openExternalUrl(card.keyUrl) }; row.append(get) }
      const msg = el('p', 'hint')
      const test = el('button', 'ai-link', ko2('연결 확인', 'Check'))
      test.onclick = async () => {
        const k = key.value.trim()
        if (!k) { msg.textContent = pcfg.hasKey ? ko2('저장된 키는 화면에 다시 보이지 않습니다. 확인하려면 키를 다시 넣으세요.', 'Saved keys are not shown again; type the key to check it.') : ko2('키를 먼저 넣으세요.', 'Enter a key first.'); return }
        msg.textContent = ko2('확인하는 중…', 'Checking…')
        const err = await checkKey(selected, k, base?.value.trim())
        msg.textContent = err ? `✕ ${err}` : `✓ ${ko2('키가 맞습니다.', 'The key works.')}`
      }
      const ok = el('button', 'primary', ko2('이 AI로 연결', 'Use this AI'))
      ok.onclick = async () => {
        const k = key.value.trim()
        if (!k && !pcfg.hasKey) { msg.textContent = ko2('키를 먼저 넣으세요.', 'Enter a key first.'); return }
        try { await store.save(selected, k || undefined, model.value.trim(), base?.value.trim()); toast(t('saved')); draw() }
        catch (e: any) { msg.textContent = '✕ ' + (e?.message ?? e) }
      }
      row.append(test)
      form.append(row, ok, msg)
      if (card?.free) form.append(el('p', 'hint', ko2('무료로 쓰는 동안 보낸 내용은 그 회사의 AI 개선에 쓰일 수 있습니다. 개인정보가 담긴 문서는 주의하세요.', 'While free, what you send may be used to improve that company\'s AI. Take care with personal data.')))
      form.append(el('p', 'hint', ko2('이 설정은 앱 전체에 하나입니다. 이음 홈(한글·마크다운)의 AI 설정과 같습니다. 키는 기기 안에 암호화되어 저장되고, AI 요청은 이 기기에서 그 회사로 바로 갑니다. Claude·ChatGPT 구독(데스크톱의 Claude Code·Codex)은 iPad에서는 쓸 수 없습니다.', 'One AI setting for the whole app — the same as the 이음 home (HWP / Markdown). Keys are stored encrypted on this device; AI requests go from this device straight to that company. Claude / ChatGPT desktop subscriptions (Claude Code, Codex) do not work on iPad.')))
    }
    draw()
  }, (e) => { box.textContent = ''; box.append(el('p', 'hint', '✕ ' + (e?.message ?? e))) })
}

function applyTheme() {
  const th = sGet('theme', 'system')
  document.documentElement.dataset.theme = th === 'system' ? '' : th
}

async function boot() {
  applyTheme()
  document.documentElement.lang = lang()
  try { await hydrate() } catch (e) { console.warn('[home hydrate]', e) }
  $<HTMLInputElement>('picker').onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) void importFile(f) }
  tabs = [{ id: 'home', kind: 'home', title: t('home') }]
  let restore: { active?: string; tabs?: Array<{ app: string; path?: string; title: string }> } = {}
  try { restore = JSON.parse(localStorage.getItem(TABS_KEY) || '{}') } catch {}
  for (const x of restore.tabs ?? []) if (!x.path || fs.existsSync(x.path)) addTab({ kind: 'app', app: x.app, path: x.path, title: x.title }, false)
  activate('home')
  // single-window rule: remember which tab was focused last
  const last = (restore.tabs ?? []).length ? tabs[tabs.length - 1].id : 'home'
  activate(last)
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'ae-open' && typeof e.data.path === 'string') void openPath(e.data.path)
    if (e.data?.type === 'ae-open-settings') { addTab({ kind: 'settings', title: t('settings') }); setTimeout(() => document.getElementById(e.data.section || 'ai')?.scrollIntoView({ block: 'start' }), 50) }
    if (e.data?.type === 'ae-office' && e.source === window.parent) {
      if (e.data.action === 'new' && APP_LABEL[e.data.app]) newBlank(e.data.app)
      if (e.data.action === 'home') activate('home')
      if (e.data.action === 'open' && typeof e.data.path === 'string') void openPath(e.data.path)
      // a file another app handed to AllEditor ("Open in AllEditor"): import into Documents and open it
      if (e.data.action === 'import' && typeof e.data.name === 'string' && typeof e.data.data === 'string') {
        const bin = atob(e.data.data); const u = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
        void importFile(new File([u], e.data.name))
      }
    }
  })
  if (EMBED) toHost({ type: 'ae-office-ready' })
  window.addEventListener('pagehide', () => { void flush() })
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush() })
}
void boot()

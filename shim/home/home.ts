// AllEditor shell: Home (files), Settings, and multi-tab hosting of the editor apps (one iframe per tab).
import fs, { DOCS_ROOT, USER_ROOT, hydrate, flush, ensureLoaded } from '../runtime/fs'
import { AI_PROVIDERS, defaultAiSettings, sanitizeAiSettings } from '@genoffice/ai-provider'
import { LANGS, tr } from './i18n'
import { convertIwork, IWORK_EXT } from '../iwork/convert'
import { getPrinters, setPrinters, restorePrinters, restoreSettings, backupSettings, sendToPrinter, testPdf, type PrinterCfg } from '../runtime/print'
import { nativeShare, nativeAi, isTauriOffice, nativeAppVersion, nativeRename, nativePickDocument, nativeStorageInfo, nativeSetStorage, Filesystem, Directory, type AiSnapshot } from '../runtime/native-files'
import { openExternalUrl } from '../runtime/electron'
import { typedPath, relName, KIND_FOLDERS } from '../runtime/folders'
import { installDiag } from '../runtime/diag'
import { installPencilUi } from '../runtime/pencil-ui'
import { pruneBackups, renderCleanup, renderDiagnostics } from './maint'

const APP_BY_EXT: Record<string, string> = {
  docx: 'docs', dotx: 'docs', doc: 'docs', dot: 'docs', odt: 'docs', ott: 'docs', hwp: 'hwp', hwpx: 'hwp',
  pptx: 'slides', potx: 'slides', ppt: 'slides', odp: 'slides', otp: 'slides',
  xlsx: 'sheets', xlsm: 'sheets', xls: 'sheets', ods: 'sheets', ots: 'sheets', csv: 'sheets', tsv: 'sheets', pdf: 'pdf',
  // Apple iWork: converted to an editable copy first (see openPath)
  pages: 'docs', key: 'slides', keyx: 'slides', numbers: 'sheets',
}
const IWORK_LABEL: Record<string, string> = { pages: 'Pages', key: 'Keynote', keyx: 'Keynote', numbers: 'Numbers' }
const tagLabel = (n: string) => IWORK_LABEL[ext(n)] ?? APP_LABEL[appFor(n)][lang() === 'ko' ? 0 : 1]
const APP_LABEL: Record<string, [string, string]> = { hwp: ['한글', 'Hangul'], docs: ['문서', 'Docs'], slides: ['슬라이드', 'Slides'], sheets: ['스프레드시트', 'Sheets'], pdf: ['PDF', 'PDF'] }
const ext = (n: string) => n.split('.').pop()!.toLowerCase()
const appFor = (n: string) => APP_BY_EXT[ext(n)]

// ---- settings store (same key the in-tab apps read: shim/runtime/shell-ipc.ts) ----
const SKEY = 'alleditor.settings'
const sLoad = (): Record<string, any> => { try { return JSON.parse(localStorage.getItem(SKEY) || '{}') } catch { return {} } }
const sGet = (k: string, d: any) => (sLoad()[k] === undefined ? d : sLoad()[k])
const sSet = (k: string, v: any) => { const s = sLoad(); s[k] = v; localStorage.setItem(SKEY, JSON.stringify(s)); backupSettings() }
const lang = () => sGet('language', 'ko') as string
const t = (k: string) => tr(lang(), k)

// ---- tabs ----
interface Tab { id: string; kind: 'home' | 'settings' | 'app'; app?: string; path?: string; title: string; /** the copy of a file picked from outside AllEditor */ importOf?: string }
const TABS_KEY = 'alleditor.tabs'
let tabs: Tab[] = []
let active = ''
const frames = new Map<string, HTMLIFrameElement>()
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e }

function saveTabs() {
  try { localStorage.setItem(TABS_KEY, JSON.stringify({ active, tabs: tabs.filter((x) => x.kind === 'app').map(({ app, path, title, importOf }) => ({ app, path, title, importOf })) })) } catch {}
}
function addTab(tab: Omit<Tab, 'id'>, focus = true): Tab {
  const existing = tabs.find((x) => x.kind === tab.kind && x.app === tab.app && x.path && x.path === tab.path) ?? (tab.kind !== 'app' ? tabs.find((x) => x.kind === tab.kind) : undefined)
  if (existing) { if (focus) activate(existing.id); return existing }
  const t2: Tab = { ...tab, id: 't' + Math.random().toString(36).slice(2, 8) }
  tabs.push(t2)
  if (t2.kind === 'app') {
    const f = el('iframe', 'pane')
    f.src = `./${t2.app}/index.html` + (t2.path ? `?open=${encodeURIComponent(t2.path)}` + (t2.importOf ? '&import=1' : '') : '')
    f.setAttribute('allow', 'clipboard-read; clipboard-write')
    f.hidden = true
    // shown from the first moment: the editor's own page takes a second or two before its loading card appears
    if (t2.path) {
      const ph = el('div', 'pane-wait'); ph.dataset.tab = t2.id
      ph.append(el('div', 'spin'), el('div', '', t2.title))
      $('panes').append(ph)
      const gone = () => ph.remove()
      f.addEventListener('load', () => setTimeout(gone, 300), { once: true }); setTimeout(gone, 20000)
    }
    $('panes').append(f); frames.set(t2.id, f)
  }
  if (focus) activate(t2.id); else renderBar()
  return t2
}
async function closeTab(id: string) {
  const tab = tabs.find((x) => x.id === id); if (!tab || tab.kind === 'home') return
  if (tab.importOf && !(await settleImport(tab))) return
  const f = frames.get(id)
  try { await (f?.contentWindow as any)?.__aeFlush?.() } catch {}
  f?.remove(); frames.delete(id)
  document.querySelector(`.pane-wait[data-tab="${id}"]`)?.remove()
  const i = tabs.indexOf(tab); tabs.splice(i, 1)
  if (active === id) activate(tabs[Math.max(0, i - 1)].id); else { renderBar(); saveTabs() }
}
// ---- copies of files picked from outside AllEditor ----
// Such a file is copied into its kind folder to be edited. Closed unsaved, the copy goes (the original stays where it
// was); saved into the copy, it stays; saved in another format (.hwp → .hwpx, .doc → .docx), the copy goes and the
// saved file stays. Closing an unsaved copy asks first: 저장 / 저장 안 함 / 취소.
const IMPORTS_KEY = 'alleditor.importCopies'
type FileMark = { size: number; mtime: number }
const readImports = (): Record<string, FileMark> => { try { return JSON.parse(localStorage.getItem(IMPORTS_KEY) || '{}') } catch { return {} } }
const writeImports = (m: Record<string, FileMark>) => { try { localStorage.setItem(IMPORTS_KEY, JSON.stringify(m)) } catch {} }
const nfc = (p: string) => p.normalize('NFC')
/** size and date of a document as the device has it now (the home's own memory does not see a tab's saves) */
async function deviceMark(path: string): Promise<FileMark | null> {
  const rel = path.replace(/^\/Documents\/?/, ''), i = rel.lastIndexOf('/')
  const dir = i < 0 ? '' : rel.slice(0, i), name = nfc(rel.slice(i + 1))
  try {
    const { files } = await Filesystem.readdir({ path: dir, directory: Directory.Documents })
    const f = (files as any[]).find((x) => nfc(String(x.name)) === name)
    return f ? { size: Number(f.size ?? 0), mtime: Number(f.mtime ?? 0) } : null
  } catch { return null }
}
async function noteImport(path: string) {
  const m = await deviceMark(path); if (!m) return
  const all = readImports(); all[nfc(path)] = m; writeImports(all)
}
function forgetImport(path: string) { const all = readImports(); if (nfc(path) in all) { delete all[nfc(path)]; writeImports(all) } }
async function dropCopy(path: string) {
  try { if (fs.existsSync(path)) fs.unlinkSync(path) } catch {}
  await flush()
  try { await Filesystem.deleteFile({ path: path.replace(/^\/Documents\/?/, ''), directory: Directory.Documents }) } catch {}
  try { const u = readUsed(); delete u[relName(path)]; localStorage.setItem(USED_KEY, JSON.stringify(u)) } catch {}
  forgetImport(path)
}
function askSave(name: string, note: string): Promise<'save' | 'discard' | 'cancel'> {
  const ko = lang() === 'ko'
  return new Promise((done) => {
    const back = el('div', 'ae-ask-back'), box = el('div', 'ae-ask')
    const head = el('div', 'ae-ask-title', ko ? `'${name}'을(를) 저장하지 않겠습니까?` : `Save '${name}' before closing?`)
    const body = el('div', 'ae-ask-body', ko
      ? `저장하지 않으면 이 파일은 AllEditor에서 지워집니다. 원래 파일은 그대로 있습니다.${note}`
      : `If you don't save, this file is removed from AllEditor. The original file stays as it was.${note}`)
    const row = el('div', 'ae-ask-row')
    const b = (label: string, v: 'save' | 'discard' | 'cancel', cls = '') => { const x = el('button', cls, label); x.onclick = () => { back.remove(); done(v) }; return x }
    row.append(b(ko ? '저장 안 함' : "Don't save", 'discard', 'danger'), el('span', 'gap'), b(ko ? '취소' : 'Cancel', 'cancel'), b(ko ? '저장' : 'Save', 'save', 'primary'))
    box.append(head, body, row); back.append(box); document.body.append(back)
  })
}
{
  const st = document.createElement('style')
  st.textContent = `.ae-ask-back{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:16px}
.ae-ask{background:var(--card,#fff);color:var(--text,#111);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.3);max-width:440px;width:100%;padding:20px 20px 16px;font:15px -apple-system,system-ui,sans-serif}
.ae-ask-title{font-weight:600;font-size:17px;margin-bottom:8px;word-break:break-all}.ae-ask-body{opacity:.8;line-height:1.45;margin-bottom:18px}
.ae-ask-row{display:flex;gap:8px;align-items:center}.ae-ask-row .gap{flex:1}
.ae-ask-row button{border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;border-radius:9px;padding:8px 14px;font:inherit}
.ae-ask-row button.primary{background:#2b6cd4;border-color:#2b6cd4;color:#fff}.ae-ask-row button.danger{color:#d33}
@media (prefers-color-scheme:dark){.ae-ask{background:#2c2c2e;color:#f2f2f7}}`
  document.head.append(st)
}
/** an imported .hwp: the editor saves it as .hwpx (start.ts __aeImportTarget) once it has loaded; the .hwp copy goes
 *  and the .hwpx is the tab's imported copy from then on (closing it unsaved asks, as for the others) */
const converting = new Set<string>()
async function convertImportedHwp(x: Tab) {
  const copy = x.importOf; if (!copy) return
  converting.add(x.id)
  try {
    let ok = false
    for (let i = 0; i < 30 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      if (!tabs.includes(x)) return
      const w = frames.get(x.id)?.contentWindow as any
      if (typeof w?.__aeSave !== 'function') continue
      try { ok = await w.__aeSave() } catch {}
      if (ok) try { await w.__aeFlush?.() } catch {}
    }
    const p = tabPath(x)
    if (!ok || !p || nfc(p) === nfc(copy)) return
    forgetImport(copy) // the .hwp copy stays in HWP, as a Keynote, Pages or Numbers copy stays in its folder
    x.path = p; x.title = p.slice(p.lastIndexOf('/') + 1); x.importOf = p
    await noteImport(p)
    markUsed(relName(p)); renderBar(); saveTabs()
    if (tabs.find((t) => t.id === active)?.kind === 'home') renderHome()
  } finally { converting.delete(x.id) }
}
/** the tab's document was saved elsewhere: the saved file is the user's, and no close prompt is needed */
async function retireCopy(x: Tab) {
  const copy = x.importOf; if (!copy) return
  x.importOf = undefined; saveTabs()
  // the copy the document came from stays (as the .hwp, Keynote, Pages and Numbers copies do); only unsaved copies go
  forgetImport(copy)
  if (tabs.find((t) => t.id === active)?.kind === 'home') renderHome()
}
/** true: the tab may close */
async function settleImport(x: Tab): Promise<boolean> {
  const copy = x.importOf!, was = readImports()[nfc(copy)]
  if (!was) return true
  const w = frames.get(x.id)?.contentWindow as any
  try { await w?.__aeFlush?.() } catch {}
  const now = await deviceMark(copy)
  if (!now) { forgetImport(copy); return true }
  // saved into the copy itself: it is the user's document now
  if (now.size !== was.size) { forgetImport(copy); return true }
  // saved under another name or format: the saved file is the user's; the copy it came from stays
  const saved = tabPath(x)
  if (saved && nfc(saved) !== nfc(copy)) { forgetImport(copy); return true }
  const name = copy.slice(copy.lastIndexOf('/') + 1), hwp = /\.hwp$/i.test(name)
  const choice = await askSave(name, hwp ? (lang() === 'ko' ? ' 저장하면 .hwpx로 저장됩니다.' : ' It is saved as .hwpx.') : '')
  if (choice === 'cancel') return false
  if (choice === 'discard') { await dropCopy(copy); return true }
  if (typeof w?.__aeSave === 'function') {
    // the editor saves (its edits, even with autosave off; a .hwp copy as .hwpx). A 한글 save that does not happen keeps
    // the tab open with the editor's message; the others write nothing when there is nothing to save
    let ok = false
    try { ok = await w.__aeSave() } catch {}
    if (!ok && /\.hwp$/i.test(copy)) return false
    try { await w.__aeFlush?.() } catch {}
    forgetImport(copy)
    return true
  }
  // the other editors: the copy is the document as it is, kept in AllEditor
  forgetImport(copy); return true
}
function activate(id: string) {
  active = id
  for (const [fid, f] of frames) f.hidden = fid !== id
  for (const ph of Array.from(document.querySelectorAll<HTMLElement>('.pane-wait'))) ph.hidden = ph.dataset.tab !== id
  const tab = tabs.find((x) => x.id === id)!
  $('homePane').hidden = tab.kind !== 'home'
  $('settingsPane').hidden = tab.kind !== 'settings'
  if (tab.kind === 'home') renderHome()
  if (tab.kind === 'settings') renderSettings()
  renderBar(); saveTabs()
}
// 전체보기: the tab bar steps aside and the tab shows its document as a viewer (shim/runtime/viewer.ts)
function startViewer(x: Tab) {
  const w = frames.get(x.id)?.contentWindow
  if (!w) return
  document.body.classList.add('ae-viewing')
  w.postMessage({ type: 'ae-viewer', on: true }, '*')
}
addEventListener('message', (e) => {
  if ((e.data as { type?: string } | null)?.type === 'ae-viewer-exit') document.body.classList.remove('ae-viewing')
})
function tabLabel(x: Tab) { return x.kind === 'home' ? t('home') : x.kind === 'settings' ? t('settings') : x.title }
// Inside the Tauri app the suite is the app's home, in a full-screen iframe (office://localhost/index.html?embed=1);
// the host can send { type: 'ae-office', action: 'new', app }.
const EMBED = (() => { try { return new URLSearchParams(location.search).has('embed') && window.parent !== window } catch { return false } })()
const toHost = (msg: object) => { try { window.parent.postMessage(msg, '*') } catch {} }
function renderBar() {
  const bar = $('tabs'); bar.textContent = ''
  for (const x of tabs) {
    const b = el('div', 'tab' + (x.id === active ? ' on' : '') + (x.app ? ' ' + x.app : ''))
    // a tap opens the tab; a long press (0.6 s) on a document tab renames it. A tap on the open tab used to rename at
    // once, which a stray touch did all too easily
    const lab = el('button', 'tl', tabLabel(x))
    let held: any = null, renamed = false
    lab.onpointerdown = () => { renamed = false; if (x.kind === 'app') held = setTimeout(() => { renamed = true; void renameTab(x) }, 600) }
    lab.onpointerup = lab.onpointerleave = lab.onpointercancel = () => clearTimeout(held)
    lab.oncontextmenu = (e) => e.preventDefault()
    lab.onclick = () => { if (renamed) { renamed = false; return } activate(x.id) }
    if (x.kind === 'app') lab.title = lang() === 'ko' ? '길게 누르면 이름을 바꿉니다' : 'Press and hold to rename'
    b.append(lab)
    if (x.id === active && x.kind === 'app') lab.title = lang() === 'ko' ? '눌러서 이름 바꾸기' : 'Tap to rename'
    if (x.kind !== 'home') { const c = el('button', 'tx', '✕'); c.setAttribute('aria-label', t('closeTab')); c.onclick = () => void closeTab(x.id); b.append(c) }
    bar.append(b)
  }
  const cur = tabs.find((x) => x.id === active)
  if (cur?.kind === 'app') {
    const view = el('button', 'viewbtn')
    view.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg><span>' + (lang() === 'ko' ? '전체보기' : 'Full view') + '</span>'
    view.setAttribute('aria-label', lang() === 'ko' ? '전체보기 (보기 전용, 쪽 넘기기)' : 'Full view (read only, page by page)')
    view.onclick = () => startViewer(cur)
    // on a phone only the icons show (web/index.html): the labels left no room for the tab's name
    const send = el('button', 'send'); send.setAttribute('aria-label', sendLabel(cur))
    send.innerHTML = '<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg><span></span>'
    send.querySelector('span')!.textContent = sendLabel(cur)
    send.onclick = () => void sendDoc(cur)
    bar.append(view, send)
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
  markUsed(relName(to), relName(path))
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
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false }) // no page zoom
setInterval(() => {
  let changed = false
  for (const x of tabs) {
    if (x.kind !== 'app') continue
    const p = tabPath(x)
    if (p && p !== x.path) { const from = x.path ? x.path.slice(x.path.lastIndexOf('/') + 1) : undefined; x.path = p; x.title = p.slice(p.lastIndexOf('/') + 1); markUsed(x.title, from); changed = true
      // an imported copy saved under another name or format (.hwp → .hwpx): the copy goes now, not at close
      if (x.importOf && nfc(p) !== nfc(x.importOf) && !converting.has(x.id)) void retireCopy(x)
    }
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
async function openPath(path: string, imported = false) {
  unhide(relName(path))
  markUsed(relName(path))
  const name = path.split('/').pop()!, app = appFor(name)
  if (!app) { alert(`${t('unsupported')}: ${name}`); return }
  const kind = IWORK_EXT[ext(name)]
  if (!kind) {
    if (imported) await noteImport(path)
    const tab = addTab({ kind: 'app', app, path, title: name, ...(imported ? { importOf: path } : {}) })
    // a picked .hwp is converted at once, as Keynote, Pages and Numbers are: the .hwpx (HWPX) is the one to edit
    if (imported && /\.hwp$/i.test(name)) void convertImportedHwp(tab)
    return
  }
  // iWork file: open its editable copy (made once, then independent of the original)
  const stem = path.replace(/\.[^.]+$/, '')
  const outExt = kind === 'pages' ? 'docx' : kind === 'keynote' ? 'pptx' : 'xlsx'
  const beside = `${stem}.${outExt}`
  if (fs.existsSync(beside)) { openPath(beside); return }
  const base = stem.slice(stem.lastIndexOf('/') + 1) + '.' + outExt
  const kindDir = typedPath(base).replace(/\/[^/]*$/, '')
  let copy = `${kindDir}/${base}`
  if (fs.existsSync(copy)) {
    // converted before: open that one (it may hold edits), or convert again into a new copy
    const ko = lang() === 'ko'
    if (!imported || confirm(ko ? `'${base}'(이전에 변환한 파일)이 이미 있습니다.\n\n[확인] 그 파일을 엽니다\n[취소] 다시 변환해 새 사본을 만듭니다` : `'${base}' (converted before) is already there.\n\n[OK] Open it\n[Cancel] Convert again into a new copy`)) { openPath(copy); return }
    copy = typedPath(base)
  }
  if (busy.has(path)) return
  // a .key read directly is the least faithful route: point to Keynote's own PowerPoint export first
  if (!confirm(`${name}\n\n${ext(name) === 'key' ? t('keyConfirm') : t('iworkConfirm')}`)) return
  busy.add(path)
  const wait = el('div', 'toast', t('converting')); document.body.append(wait)
  try {
    await ensureLoaded(path) // big files are only listed until needed
    const b = fs.readFileSync(path) as Uint8Array
    const r = await convertIwork(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, kind)
    fs.writeFileSync(copy, r.bytes); await flush()
    // a picked iWork file: its converted copy is the one to edit (the picked copy stays in its folder)
    wait.remove(); openPath(copy, imported)
  } catch (e: any) { wait.remove(); alert(`${t('convertFailed')}: ${e?.message ?? e}`) }
  finally { busy.delete(path) }
}
function newBlank(app: string) { addTab({ kind: 'app', app, title: APP_LABEL[app][lang() === 'ko' ? 0 : 1] + ' ' + (tabs.filter((x) => x.app === app).length + 1) }) }
const uniq = (name: string) => typedPath(name) // new files go into the folder of their kind
async function importFile(f: File) {
  const name = f.name.replace(/[\\/:*?"<>|]/g, '_')
  if (!appFor(name)) { alert(`${t('unsupported')}: ${name}`); return }
  const p = uniq(name)
  fs.writeFileSync(p, new Uint8Array(await f.arrayBuffer()))
  await flush()
  void openPath(p, true)
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
  const loc = lang() === 'ko' ? 'ko-KR' : 'en-US'
  const d = new Date(ms), now = new Date()
  const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return time
  const date = d.getFullYear() === now.getFullYear() ? d.toLocaleDateString(loc, { month: 'short', day: 'numeric' }) : d.toLocaleDateString(loc)
  return `${date} ${time}`
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
      // the copy may sit in a kind folder (Hangul, Word …) this page has not seen yet
      fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
      fs.writeFileSync(path, u)
    }
    let opened = path
    // the copy was numbered because a file of that name is there: ask whether it replaces that file
    const m = (r as any).copied === true ? /^(.*) (\d+)(\.[^./]+)$/.exec(r.name) : null
    if (m && fs.existsSync(`${DOCS_ROOT}/${m[1]}${m[3]}`)) {
      const base = `${m[1]}${m[3]}`, ko = lang() === 'ko', short = base.slice(base.lastIndexOf('/') + 1)
      if (confirm(ko ? `'${short}'이(가) 이미 있습니다.\n\n[확인] 가져온 파일로 바꿉니다\n[취소] 둘 다 둡니다 (${r.name.slice(r.name.lastIndexOf('/') + 1)})` : `'${short}' is already there.\n\n[OK] Replace it with the picked file\n[Cancel] Keep both`)) {
        try {
          await ensureLoaded(path)
          const bytes = fs.readFileSync(path) as Uint8Array
          fs.writeFileSync(`${DOCS_ROOT}/${base}`, bytes); fs.unlinkSync(path); await flush()
          opened = `${DOCS_ROOT}/${base}`
        } catch (e) { console.warn('[picker replace]', e) }
      }
    }
    void openPath(opened, (r as any).copied === true)
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
type Row = { n: string; size: number; m: number; cloud?: boolean }
const HIDDEN_KEY = 'alleditor.recentHidden'
const readHidden = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '{}') } catch { return {} } }
const writeHidden = (h: Record<string, number>) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(h)) } catch {} }
// when a document was last opened or saved in the app: the list shows and sorts by it when it is newer than the
// file's own time (files moved into iCloud together can share one modification time)
const USED_KEY = 'alleditor.recentUsed'
const readUsed = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(USED_KEY) || '{}') } catch { return {} } }
function markUsed(name: string, from?: string) {
  try { const u = readUsed(); if (from) delete u[from]; u[name] = Date.now(); localStorage.setItem(USED_KEY, JSON.stringify(u)) } catch {}
}
function unhide(name: string) { const h = readHidden(); if (name in h) { delete h[name]; writeHidden(h) } }
// the documents at the top of AllEditor and in its kind folders (Hangul, Word, …): r.n is the path below AllEditor
// the folders that keep only the files documents were converted from (HWP → HWPX, Pages → Word, Keynote → PowerPoint,
// Numbers → Excel) are not listed: their converted copies are
const SOURCE_FOLDERS = new Set(['HWP', 'Pages', 'Keynote', 'Numbers'])
const LIST_DIRS = ['', ...KIND_FOLDERS.filter((d) => !SOURCE_FOLDERS.has(d))]
function memRows(): Row[] {
  const out: Row[] = []
  for (const d of LIST_DIRS) {
    let names: string[] = []
    try { names = fs.readdirSync(d ? `${DOCS_ROOT}/${d}` : DOCS_ROOT).map(String).filter((n: string) => !n.startsWith('.') && appFor(n)) } catch {}
    for (const n of names) { const rel = d ? `${d}/${n}` : n; try { const st = fs.statSync(`${DOCS_ROOT}/${rel}`); if (st.isFile()) out.push({ n: rel, size: st.size as number, m: Number(st.mtimeMs ?? 0) }) } catch {} }
  }
  return out
}
async function nativeRows(): Promise<Row[] | null> {
  if (!isTauriOffice()) return null
  try {
    const out: Row[] = []
    for (const d of LIST_DIRS) {
      const { files } = await Filesystem.readdir({ path: d, directory: Directory.Documents }).catch(() => ({ files: [] as any[] }))
      for (const f of files as any[]) if (f.type !== 'directory' && !String(f.name).startsWith('.') && appFor(String(f.name)))
        out.push({ n: d ? `${d}/${f.name}` : String(f.name), size: Number(f.size ?? 0), m: Number(f.mtime ?? 0), cloud: !!f.cloud })
    }
    return out
  } catch { return null }
}
// grouped by kind (한글 · Word · PowerPoint · Excel · PDF · Pages · Keynote · Numbers), newest first in each group,
// or one list newest first; the choice is remembered
const RECENT_VIEW_KEY = 'alleditor.recentView'
const recentView = (): 'kind' | 'time' => { try { return localStorage.getItem(RECENT_VIEW_KEY) === 'time' ? 'time' : 'kind' } catch { return 'kind' } }
const KIND_ORDER = ['hwp', 'docs', 'slides', 'sheets', 'pdf', 'pages', 'key', 'numbers']
const kindOf = (n: string) => (ext(n) === 'keyx' ? 'key' : IWORK_LABEL[ext(n)] ? ext(n) : appFor(n))
function fillRecent(list: HTMLElement, all: Row[]) {
  const ko = lang() === 'ko'
  const hidden = readHidden()
  const used = readUsed()
  const rows = all.map((r) => ({ ...r, m: Math.max(r.m, used[r.n] ?? 0) }))
    .filter((r) => !(r.n in hidden) || r.m > hidden[r.n]).sort((a, b) => b.m - a.m)
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
  const meta = el('span', 'meta'); meta.append(el('span', 'nm', r.n.slice(r.n.lastIndexOf('/') + 1)), el('span', 'sz', [typeName(r.n), r.cloud ? (lang() === 'ko' ? '☁︎ iCloud (열면 내려받음)' : '☁︎ iCloud (downloads when opened)') : fmt(r.size), ago(r.m)].filter(Boolean).join(' · ')))
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
  // in the app the device's folder gives the real times; this page's in-memory copies only carry the time they
  // were loaded (the same for all), so they are shown only when the device cannot be asked
  let last: Row[] = isTauriOffice() ? [] : memRows()
  const draw = (rows: Row[]) => { last = rows; fillRecent(list, rows) }
  for (const [v, label] of [['kind', ko ? '종류별' : 'By type'], ['time', ko ? '최신순' : 'Newest']] as const) {
    const btn = el('button', recentView() === v ? 'on' : '', label)
    btn.onclick = () => { try { localStorage.setItem(RECENT_VIEW_KEY, v) } catch {}; for (const x of seg.children) x.classList.toggle('on', x === btn); fillRecent(list, last) }
    seg.append(btn)
  }
  rhead.append(el('h2', '', ko ? '최근 문서' : 'Recent documents'), seg)
  wrap.append(rhead, list)
  if (!isTauriOffice()) draw(last)
  // documents saved by an editor tab (each tab is its own page) or added in the Files app: ask the device
  void nativeRows().then((rows) => { if (list.isConnected) draw(rows ?? memRows()) })
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

let appVersion = ''
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
  // saved while typing: closing the 설정 tab right after typing (no blur, no change event) kept the old name
  const au = el('input'); au.type = 'text'; au.value = sGet('authorName', '')
  au.oninput = () => sSet('authorName', au.value.trim())
  au.onchange = () => { sSet('authorName', au.value.trim()); changed(false) }
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

  renderStorage(wrap, toast)
  renderCleanup(wrap, el, lang() === 'ko', toast)
  renderDiagnostics(wrap, el, lang() === 'ko', toast, () => appVersion)

  const ver = el('p', 'hint ver')
  wrap.append(el('h2', '', t('about')), ver, el('p', 'hint', t('aboutText')), creditEl())
  if (isTauriOffice()) void nativeAppVersion().then((v) => { appVersion = `${v.version} (${v.build})`; ver.textContent = lang() === 'ko' ? `AllEditor 버전 ${v.version} (빌드 ${v.build})` : `AllEditor version ${v.version} (build ${v.build})` }, () => {})
}

// ---- AI 연결 (iPad): API-key providers only — the desktop subscriptions (Claude Code, Codex, ChatGPT sign-in)
// run a PC program or need the desktop app's own sign-in, so they are not offered here.
interface ConnectCard { id: string; name: string; sub: [string, string]; keyUrl: string; free?: boolean }
const CONNECT_CARDS: ConnectCard[] = [
  { id: 'gemini', name: 'Google Gemini', sub: ['무료 키로 시작할 수 있습니다 (하루 한도 있음)', 'Free key available (daily limit)'], keyUrl: 'https://aistudio.google.com/apikey', free: true },
  { id: 'openai', name: 'ChatGPT (OpenAI API)', sub: ['OpenAI API 키 — 쓴 만큼 요금이 나갑니다', 'OpenAI API key — pay as you go'], keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Claude (Anthropic API)', sub: ['Anthropic API 키 — 쓴 만큼 요금이 나갑니다', 'Anthropic API key — pay as you go'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'baze', name: 'BAZE Gateway (factchat-cloud)', sub: ['키 하나로 Claude·GPT·Gemini 등 — 쓴 만큼 크레딧 차감', 'One key for Claude, GPT, Gemini … — credits per use'], keyUrl: 'https://docs.mindlogic.ai' },
  { id: 'openrouter', name: 'OpenRouter', sub: ['여러 회사 모델을 키 하나로, 무료 모델도 있습니다', 'Many models with one key, some free'], keyUrl: 'https://openrouter.ai/keys', free: true },
]
// BAZE API Gateway: OpenAI-compatible, one fixed host (the native store keeps it as "baze"; the office editors
// see it as their `custom` provider with this base URL)
const BAZE_BASE = 'https://factchat-cloud.mindlogic.ai/v1/gateway'
const BAZE_META = { id: 'baze', label: 'BAZE Gateway (factchat-cloud)', models: ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-fable-5', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5'], defaultModel: 'claude-sonnet-5', keyPlaceholder: 'BAZE API key' }
const NOT_ON_IOS = new Set(['claude-code', 'codex', 'chatgpt', 'genspark', 'auto'])
const ko2 = (k: string, e: string) => (lang() === 'ko' ? k : e)

/** a cheap request that only succeeds with a valid key */
async function checkKey(id: string, key: string, baseUrl?: string, models?: string[]): Promise<string | null> {
  const f = (globalThis as any).fetch as typeof fetch
  let r: Response
  try {
    if (id === 'gemini') r = await f(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`)
    else if (id === 'anthropic') r = await f('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })
    else if (id === 'openrouter') r = await f('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } })
    else if (id === 'openai') r = await f('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } })
    else if (id === 'baze') r = await f(`${BAZE_BASE}/models/`, { headers: { authorization: `Bearer ${key}` } })
    else if (baseUrl) r = await f(baseUrl.replace(/\/$/, '') + '/models', { headers: { authorization: `Bearer ${key}` } })
    else return null
  } catch (e: any) { return ko2('네트워크 오류: ', 'Network error: ') + (e?.message ?? e) }
  if (r.ok) {
    if (models) try { const j: any = await r.json(); for (const m of j?.data ?? j?.models ?? []) { const mid = typeof m === 'string' ? m : m?.id; if (mid) models.push(String(mid)) } } catch {}
    return null
  }
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
    provider: cur.provider === 'custom' && cur.providers?.custom?.baseUrl === BAZE_BASE ? 'baze' : cur.provider,
    cfg: (id) => { const c = cur.providers[id === 'baze' ? 'custom' : id] ?? {}; return { hasKey: !!c.apiKey, key: c.apiKey ?? '', model: c.model ?? '', models: c.models ?? [] } },
    async save(provider, key, model, baseUrl) {
      if (provider === 'baze') { provider = 'custom'; baseUrl = BAZE_BASE }
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
  const metas = [...(AI_PROVIDERS as any[]).filter((m) => !m.needsCliPath && !NOT_ON_IOS.has(m.id) && m.id !== 'custom'), BAZE_META]
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
        const found: string[] = []
        const err = await checkKey(selected, k, base?.value.trim(), found)
        msg.textContent = err ? `✕ ${err}` : `✓ ${ko2('키가 맞습니다.', 'The key works.')}` + (found.length ? ` ${ko2(`모델 ${found.length}개 — 모델 칸에서 고르세요.`, `${found.length} models — pick one in the Model field.`)}` : '')
        if (found.length) { dl.textContent = ''; for (const id of found) { const o = el('option'); o.value = id; dl.append(o) } }
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

// ---- 문서 저장 위치: where the AllEditor folder lives (iCloud Drive by default) ----
function renderStorage(wrap: HTMLElement, toast: (m: string) => void) {
  const ko = lang() === 'ko'
  const h = el('h2', '', ko ? '문서 저장 위치' : 'Document location'); h.id = 'storage'; wrap.append(h)
  const box = el('div', 'group'); wrap.append(box)
  if (!isTauriOffice()) { box.append(el('p', 'hint', ko ? 'iPad 앱에서 고를 수 있습니다.' : 'Available in the iPad app.')); return }
  box.append(el('p', 'hint', ko ? '불러오는 중…' : 'Loading…'))
  const CHOICES: Array<[string, string, string]> = [
    ['icloud', 'iCloud Drive › AllEditor', ko ? '기본. Mac·iPhone 등 같은 Apple 계정의 기기에서도 보입니다.' : 'Default. Also on your other Apple devices.'],
    ['local', ko ? '나의 iPad › AllEditor' : 'On My iPad › AllEditor', ko ? '이 iPad에만 저장합니다 (앱을 지우면 함께 지워집니다).' : 'Only on this iPad (removed with the app).'],
    ['custom', ko ? '다른 위치 › AllEditor' : 'Elsewhere › AllEditor', ko ? '파일 앱의 다른 폴더(다른 클라우드, 외장 드라이브 등) 안에 AllEditor 폴더를 만듭니다.' : 'An AllEditor folder inside another Files location (another cloud, an external drive…).'],
  ]
  const draw = (info: any) => {
    box.textContent = ''
    box.append(el('p', 'hint ai-status on', `● ${ko ? '현재' : 'Now'}: ${info.label}`))
    const cards = el('div', 'ai-cards'); box.append(cards)
    for (const [kind, name, sub] of CHOICES) {
      const b = el('button', 'ai-card' + (info.kind === kind ? ' sel cur' : ''))
      b.append(el('b', '', name), el('span', '', sub))
      if (kind === 'icloud' && !info.icloudAvailable) { b.disabled = true; b.title = ko ? 'iCloud Drive가 꺼져 있습니다' : 'iCloud Drive is off' }
      b.onclick = () => void change(kind, info)
      cards.append(b)
    }
    box.append(el('p', 'hint', ko ? '어디에 두든 폴더 이름은 AllEditor입니다. 프린터 같은 설정은 위치를 바꿀 때 함께 옮겨집니다.' : 'Wherever it is, the folder is named AllEditor. Settings such as printers move with it.'))
  }
  const change = async (kind: string, info: any) => {
    if (kind === info.kind && kind !== 'custom') return
    const target = CHOICES.find((c) => c[0] === kind)![1]
    if (!confirm(ko ? `문서 저장 위치를 "${target}"(으)로 바꿀까요?` : `Change the document location to "${target}"?`)) return
    const copy = confirm(ko
      ? `지금 폴더(${info.label})의 문서를 새 위치로 복사할까요?\n\n확인: 문서를 복사합니다 (원래 폴더의 문서는 그대로 남습니다)\n취소: 문서는 복사하지 않습니다\n\n프린터 등 설정은 어느 쪽이든 새 위치로 옮겨집니다.`
      : `Copy the documents of the current folder (${info.label}) to the new location?\n\nOK: copy them (the originals stay)\nCancel: don't copy\n\nSettings such as printers move either way.`)
    try { await flush() } catch {}
    const wait = el('div', 'toast', ko ? '바꾸는 중…' : 'Changing…'); document.body.append(wait)
    try {
      const r = await nativeSetStorage(kind, copy)
      wait.remove()
      if (r.canceled) return
      const note = copy ? (ko ? `문서 ${r.copied ?? 0}개를 복사했습니다.` : `${r.copied ?? 0} documents copied.`) + (r.failed ? (ko ? ` (${r.failed}개는 복사하지 못했습니다)` : ` (${r.failed} could not be copied)`) : '') : ''
      alert((ko ? `문서 저장 위치: ${r.label}` : `Document location: ${r.label}`) + (note ? '\n' + note : '') + (ko ? '\n\n새 위치로 다시 엽니다.' : '\n\nReopening with the new location.'))
      location.reload()
    } catch (e: any) { wait.remove(); alert((ko ? '바꾸지 못했습니다: ' : 'Could not change: ') + (e?.message ?? e)) }
  }
  nativeStorageInfo().then(draw, (e) => { box.textContent = ''; box.append(el('p', 'hint', '✕ ' + (e?.message ?? e))) })
}

function applyTheme() {
  const th = sGet('theme', 'system')
  document.documentElement.dataset.theme = th === 'system' ? '' : th
}

async function boot() {
  applyTheme()
  document.documentElement.lang = lang()
  installDiag('home')
  installPencilUi()
  try { await hydrate() } catch (e) { console.warn('[home hydrate]', e) }
  void pruneBackups() // save backups older than 30 days
  // printers saved in the AllEditor folder come back after a reinstall (redraw 설정 if it is open)
  // a reinstall: 설정 (author, theme, language …) and printers come back from the AllEditor folder
  void restoreSettings().then(async (got) => {
    const printers = await restorePrinters().catch(() => false)
    if (got) { applyTheme(); renderBar(); renderHome() }
    if ((got || printers) && !$('settingsPane').hidden) renderSettings()
  }).catch(() => {})
  $<HTMLInputElement>('picker').onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) void importFile(f) }
  tabs = [{ id: 'home', kind: 'home', title: t('home') }]
  let restore: { active?: string; tabs?: Array<{ app: string; path?: string; title: string }> } = {}
  try { restore = JSON.parse(localStorage.getItem(TABS_KEY) || '{}') } catch {}
  for (const x of restore.tabs ?? []) if (!x.path || fs.existsSync(x.path)) addTab({ kind: 'app', app: x.app, path: x.path, title: x.title, ...(x.importOf ? { importOf: x.importOf } : {}) }, false)
  // copies whose tab is gone (the app was closed with it open) are kept: they are documents in AllEditor now
  { const all = readImports(), open = new Set(tabs.map((x) => x.importOf && nfc(x.importOf))); for (const k of Object.keys(all)) if (!open.has(k)) delete all[k]; writeImports(all) }
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

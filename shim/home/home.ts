// AllEditor shell: Home (files), Settings, and multi-tab hosting of the editor apps (one iframe per tab).
import fs, { DOCS_ROOT, USER_ROOT, hydrate, flush } from '../runtime/fs'
import { AI_PROVIDERS, defaultAiSettings, sanitizeAiSettings } from '@genoffice/ai-provider'
import { LANGS, tr } from './i18n'
import { convertIwork, IWORK_EXT } from '../iwork/convert'
import { getPrinters, setPrinters, sendToPrinter, testPdf, type PrinterCfg } from '../runtime/print'

const APP_BY_EXT: Record<string, string> = {
  docx: 'docs', dotx: 'docs', doc: 'docs', dot: 'docs', odt: 'docs', ott: 'docs', hwp: 'docs', hwpx: 'docs',
  pptx: 'slides', potx: 'slides', ppt: 'slides', odp: 'slides', otp: 'slides',
  xlsx: 'sheets', xlsm: 'sheets', xls: 'sheets', ods: 'sheets', ots: 'sheets', csv: 'sheets', tsv: 'sheets', pdf: 'pdf',
  // Apple iWork: converted to an editable copy first (see openPath)
  pages: 'docs', key: 'slides', numbers: 'sheets',
}
const IWORK_LABEL: Record<string, string> = { pages: 'Pages', key: 'Keynote', numbers: 'Numbers' }
const tagLabel = (n: string) => IWORK_LABEL[ext(n)] ?? APP_LABEL[appFor(n)][lang() === 'ko' ? 0 : 1]
const APP_LABEL: Record<string, [string, string]> = { docs: ['문서', 'Docs'], slides: ['슬라이드', 'Slides'], sheets: ['스프레드시트', 'Sheets'], pdf: ['PDF', 'PDF'] }
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
function renderBar() {
  const bar = $('tabs'); bar.textContent = ''
  for (const x of tabs) {
    const b = el('div', 'tab' + (x.id === active ? ' on' : '') + (x.app ? ' ' + x.app : ''))
    const lab = el('button', 'tl', tabLabel(x)); lab.onclick = () => activate(x.id); b.append(lab)
    if (x.kind !== 'home') { const c = el('button', 'tx', '✕'); c.setAttribute('aria-label', t('closeTab')); c.onclick = () => void closeTab(x.id); b.append(c) }
    bar.append(b)
  }
  const gear = el('button', 'gear' + (tabs.find((x) => x.id === active)?.kind === 'settings' ? ' on' : ''), '⚙'); gear.setAttribute('aria-label', t('settings'))
  gear.onclick = () => addTab({ kind: 'settings', title: t('settings') })
  bar.append(gear)
  bar.querySelector('.tab.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
}

// ---- files ----
const CREDIT = 'ieum office · Developed by JaiSung NOH MD 2026'
const busy = new Set<string>()
async function openPath(path: string) {
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

function renderHome() {
  const root = $('homePane'); root.textContent = ''
  const wrap = el('main'); root.append(wrap)
  const open = el('button', 'primary', t('openFile')); open.onclick = () => $<HTMLInputElement>('picker').click(); wrap.append(open)
  wrap.append(el('h2', '', t('newSection')))
  const grid = el('div', 'grid')
  for (const [app, key] of [['docs', 'newDoc'], ['slides', 'newSlides'], ['sheets', 'newSheet']] as const) {
    const b = el('button', 'card ' + app, t(key)); b.onclick = () => newBlank(app); grid.append(b)
  }
  wrap.append(grid)
  wrap.append(el('h2', '', t('recent')))
  const list = el('div', 'files'); wrap.append(list)
  let names: string[] = []
  try { names = fs.readdirSync(DOCS_ROOT).map(String).filter((n: string) => !n.startsWith('.') && appFor(n)) } catch {}
  const rows = names.map((n) => { const st = fs.statSync(`${DOCS_ROOT}/${n}`); return { n, size: st.size as number, m: Number(st.mtimeMs ?? 0) } }).sort((a, b) => b.m - a.m)
  if (!rows.length) list.append(el('p', 'empty', t('empty')))
  wrap.append(el('p', 'credit', CREDIT))
  for (const r of rows) {
    const row = el('div', 'row'); const b = el('button', 'file')
    const tag = el('span', 'tag ' + appFor(r.n), tagLabel(r.n)); const nm = el('span', 'nm', r.n); const sz = el('span', 'sz', fmt(r.size))
    b.append(tag, nm, sz); b.onclick = () => openPath(`${DOCS_ROOT}/${r.n}`)
    const d = el('button', 'del', '✕'); d.setAttribute('aria-label', t('del'))
    d.onclick = async () => { if (!confirm(`${r.n}\n${t('confirmDel')}`)) return; fs.rmSync(`${DOCS_ROOT}/${r.n}`, { force: true }); await flush(); renderHome() }
    row.append(b, d); list.append(row)
  }
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
  g.append(field(t('docTheme'), select([['follow', t('follow')], ['light', t('themeLight')], ['dark', t('themeDark')]], sGet('documentTheme', 'follow'), (v) => { sSet('documentTheme', v); changed(true) })))
  const mu = sGet('measurementUnit', { unit: 'cm', explicit: false })
  g.append(field(t('unit'), select([['cm', 'cm'], ['in', 'in'], ['mm', 'mm'], ['pt', 'pt'], ['pi', 'pica']], mu.unit, (v) => { sSet('measurementUnit', { unit: v, explicit: true }); changed(true) })))
  g.append(field(t('autosave'), select([['1', t('on')], ['0', t('off')]], sGet('autoSave', { on: true }).on ? '1' : '0', (v) => { sSet('autoSave', { on: v === '1', updatedAt: Date.now() }); changed(true) })))
  const au = el('input'); au.type = 'text'; au.value = sGet('authorName', ''); au.onchange = () => { sSet('authorName', au.value.trim()); changed(false) }
  g.append(field(t('author'), au))
  wrap.append(el('p', 'hint', t('reloadHint')))

  wrap.append(el('h2', '', t('ai')))
  const a = el('div', 'group'); wrap.append(a)
  const stored = readAi()
  const def = defaultAiSettings()
  const cur = { ...def, ...stored, providers: { ...def.providers, ...(stored.providers ?? {}) } } as any
  const metas = AI_PROVIDERS.filter((m: any) => !m.needsCliPath)
  let provider: string = metas.some((m: any) => m.id === cur.provider && m.id !== 'genspark') ? cur.provider : metas.find((m: any) => m.id !== 'genspark')?.id ?? metas[0].id
  const body = el('div'); const note = el('p', 'hint')
  const draw = () => {
    body.textContent = ''
    const meta: any = metas.find((m: any) => m.id === provider)!; const cfg = cur.providers[provider] ?? {}
    note.textContent = provider === 'genspark' ? t('gsk') : t('aiNote')
    if (provider === 'genspark') return
    const key = el('input'); key.type = 'password'; key.placeholder = meta.keyPlaceholder ?? ''; key.value = cfg.apiKey ?? ''; key.autocomplete = 'off'
    const dl = el('datalist'); dl.id = 'models'; for (const m of meta.models ?? []) { const o = el('option'); o.value = m; dl.append(o) }
    const model = el('input'); model.type = 'text'; model.setAttribute('list', 'models'); model.value = cfg.model || meta.defaultModel || ''
    body.append(field(t('apiKey'), key), field(t('model'), model), dl)
    let base: HTMLInputElement | null = null
    if (meta.needsBaseUrl) { base = el('input'); base.type = 'url'; base.value = cfg.baseUrl ?? ''; base.placeholder = 'https://…/v1'; body.append(field(t('baseUrl'), base)) }
    const save = el('button', 'primary', t('save'))
    save.onclick = async () => {
      const next: any = { ...cur, provider, providers: { ...cur.providers, [provider]: { ...cfg, apiKey: key.value.trim(), model: model.value.trim(), ...(base ? { baseUrl: base.value.trim() } : {}) } } }
      const clean = sanitizeAiSettings(next) ?? next
      fs.mkdirSync(USER_ROOT, { recursive: true }); fs.writeFileSync(AI_FILE, JSON.stringify(clean, null, 2)); await flush()
      Object.assign(cur, clean); reloadFrames(); toast(t('saved'))
    }
    body.append(save)
  }
  a.append(field(t('provider'), select(metas.map((m: any) => [m.id, m.label]), provider, (v) => { provider = v; draw() })), body, note)
  draw()

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

  wrap.append(el('h2', '', t('about')), el('p', 'hint', t('aboutText')), el('p', 'credit', CREDIT))
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
  window.addEventListener('message', (e) => { if (e.data?.type === 'ae-open' && typeof e.data.path === 'string') void openPath(e.data.path) })
  window.addEventListener('pagehide', () => { void flush() })
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush() })
}
void boot()

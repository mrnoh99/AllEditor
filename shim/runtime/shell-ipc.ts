// Handlers the Electron *shell* app normally provides (settings, theme, locale …).
import { ipcMain } from './electron'
import { DEFAULT_AI_PANEL_PREFS } from '@genoffice/ui'
import { isPhone } from './phone'
import fs, { USER_ROOT, flush, keepInMemory } from './fs'
import { isTauriOffice, nativeAi, Filesystem, Directory } from './native-files'
import { webContents } from './electron'
import { defaultAiSettings } from '@genoffice/ai-provider'

const KEY = 'alleditor.settings'
const load = (): Record<string, any> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
const save = (s: Record<string, any>) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {} }
const get = (k: string, d: any) => { const v = load()[k]; return v === undefined ? d : v }
const set = (k: string, v: any) => { const s = load(); s[k] = v; save(s) }

export function registerShellIpc() {
  const h = (ch: string, f: (...a: any[]) => any) => ipcMain.handle(ch, (_e: any, ...a: any[]) => f(...a))
  const lang = () => {
    // Korean by default; a saved language setting wins
    const l = String(get('language', 'ko')).slice(0, 2)
    return ['zh', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar', 'en'].includes(l) ? l : 'ko'
  }
  h('app:get-language', lang)
  h('app:get-theme', () => get('theme', 'system'))
  h('app:get-document-theme', () => get('documentTheme', 'follow'))
  h('app:get-measurement-unit', () => get('measurementUnit', { unit: 'in', explicit: false }))
  h('app:set-measurement-unit', (u: any) => { set('measurementUnit', u === null ? { unit: 'in', explicit: false } : { unit: u, explicit: true }); return get('measurementUnit', null) })
  h('app:get-auto-save-default', () => get('autoSave', { on: true, updatedAt: 0 }))
  h('app:get-author-name', () => get('authorName', ''))
  h('app:get-csv-import-limit', () => 200)
  const phonePrefs = () => (isPhone() ? { openInNewDocs: false } : {})
  h('app:get-ai-panel-prefs', () => ({ ...DEFAULT_AI_PANEL_PREFS, ...get('aiPanelPrefs', {}), ...phonePrefs() }))
  h('app:set-ai-panel-prefs', (p: any) => { const n = { ...get('aiPanelPrefs', {}), ...p }; set('aiPanelPrefs', n); return { ...DEFAULT_AI_PANEL_PREFS, ...n, ...phonePrefs() } })
  h('kb:list', () => [])
  h('ai:gsk-status', () => ({ available: false }))

  // 이음오피스 shell-level features that have no iOS counterpart: answered as "none / off" so the editors run
  h('app:get-editor-choice', () => ({ off: [], aiFeatures: true, locked: false }))
  h('app:set-editor-choice', () => ({ off: [], aiFeatures: true, locked: false }))
  h('app:editor-pick-due', () => false)
  h('app:mark-editor-pick-seen', () => undefined)
  h('app:ai-job-count', () => 0)
  h('app:stop-all-ai-jobs', () => 0)
  h('app:get-split-role', () => 'focus')
  h('mcp-tools:list', () => [])
  h('skills:list', () => [])
  h('skills:take-handoff', () => null)
  h('skills:take-dropped', () => null)
  h('ai:internet-tools', () => false)
  h('drive:ai-enabled', () => false)
  h('drive:connected', () => false)
  h('doc:attach-available', () => false)
  h('doc:attach-list', () => [])
  h('connector:attach-sources', () => ({ obsidian: false, notion: false, canva: false }))
  h('projectFolder:listProjects', () => [])
  h('projectFolder:getSelection', () => ({ projectId: null, initialChatId: null }))
  h('projectFolder:setSelection', () => ({ projectId: null, initialChatId: null }))
  h('projectFolder:getDefaultParentFolder', () => '/Documents')
  h('pdf:store-doc-hash', () => null)

  // AI: the panel's "settings" button opens AllEditor's AI 연결 page (home settings tab, #ai)
  const openAiSettings = () => {
    try { if (window.parent !== window) { window.parent.postMessage({ type: 'ae-open-settings', section: 'ai' }, '*'); return } } catch {}
    location.href = '../index.html#ai'
  }
  h('ai:open-model-settings', openAiSettings)
  h('ai:open-settings', openAiSettings)
  if (!isTauriOffice()) ensureIosAiProvider()
  ;(globalThis as any).__aeAiRefresh = async () => { await syncAiFromNative(); webContents.send('ai:settings-changed') }
}

/**
 * On iPad the desktop's "auto" (Claude / ChatGPT subscriptions first) cannot run: with no selection the AI panel
 * offers subscription cards that cannot connect here. Default the selection to Gemini (a key provider with a free
 * key), so the panel asks for that key and its "settings" button leads to the AI 연결 page.
 */
function ensureIosAiProvider() {
  const file = `${USER_ROOT}/ai-settings.json`
  let cur: any = {}
  try { cur = JSON.parse(String(fs.readFileSync(file, 'utf8'))) } catch {}
  if (cur.provider && cur.providers && !['auto', 'claude-code', 'codex', 'chatgpt'].includes(cur.provider)) return
  try {
    fs.mkdirSync(USER_ROOT, { recursive: true })
    // a file without `providers` reads as a legacy file and falls back to "auto": write the full shape
    const base: any = defaultAiSettings()
    fs.writeFileSync(file, JSON.stringify({ ...base, ...cur, providers: { ...base.providers, ...(cur.providers ?? {}) }, provider: 'gemini' }, null, 2))
    void flush()
  } catch (e) { console.warn('[ai] default provider', e) }
}

const AI_FILE = `${USER_ROOT}/ai-settings.json`
/**
 * The app's one AI setting lives in the 이음오피스 store (Rust, keys sealed). The office editors read
 * /userData/ai-settings.json, so it is built here from that store, in this page's memory only.
 * A plain file an earlier build wrote is moved into the store once and removed from the device.
 */
export async function syncAiFromNative() {
  if (!isTauriOffice()) return
  keepInMemory(AI_FILE)
  let old: any = null
  try { old = JSON.parse(String(fs.readFileSync(AI_FILE, 'utf8'))) } catch {}
  let ex = await nativeAi.export().catch((e) => { console.warn('[ai] export', e); return null })
  if (!ex) return
  const oldCfg = old?.provider && old.providers?.[old.provider]
  if (oldCfg?.apiKey && !ex.providers[old.provider]?.apiKey && !String(oldCfg.apiKey).startsWith('sealed:')) {
    try { await nativeAi.set({ provider: old.provider, apiKey: oldCfg.apiKey, model: oldCfg.model }); ex = await nativeAi.export() } catch (e) { console.warn('[ai] migrate', e) }
  }
  if (old) void Filesystem.deleteFile({ path: 'ai-settings.json', directory: Directory.Support }).catch(() => {})
  const base: any = defaultAiSettings()
  const providers: any = { ...base.providers }
  for (const [id, cfg] of Object.entries(ex.providers)) providers[id] = { ...(providers[id] ?? {}), ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}), ...(cfg.model ? { model: cfg.model } : {}) }
  fs.mkdirSync(USER_ROOT, { recursive: true })
  fs.writeFileSync(AI_FILE, JSON.stringify({ ...base, ...(old && typeof old === 'object' ? { search: old.search, media: old.media } : {}), provider: ex.provider, providers }, null, 2))
}

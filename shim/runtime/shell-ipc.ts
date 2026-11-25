// Handlers the Electron *shell* app normally provides (settings, theme, locale …).
import { ipcMain } from './electron'
import { DEFAULT_AI_PANEL_PREFS } from '@genoffice/ui'
import { isPhone } from './phone'

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
}

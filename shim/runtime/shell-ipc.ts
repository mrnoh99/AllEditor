// Handlers the Electron *shell* app normally provides (settings, theme, locale …).
import { ipcMain } from './electron'
import { DEFAULT_AI_PANEL_PREFS } from '@genoffice/ui'

const KEY = 'alleditor.settings'
const load = (): Record<string, any> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
const save = (s: Record<string, any>) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {} }
const get = (k: string, d: any) => { const v = load()[k]; return v === undefined ? d : v }
const set = (k: string, v: any) => { const s = load(); s[k] = v; save(s) }

export function registerShellIpc() {
  const h = (ch: string, f: (...a: any[]) => any) => ipcMain.handle(ch, (_e: any, ...a: any[]) => f(...a))
  const lang = () => {
    const l = (get('language', null) ?? navigator.language).slice(0, 2)
    return ['zh', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar'].includes(l) ? l : 'en'
  }
  h('app:get-language', lang)
  h('app:get-theme', () => get('theme', 'system'))
  h('app:get-document-theme', () => get('documentTheme', 'follow'))
  h('app:get-measurement-unit', () => get('measurementUnit', { unit: 'in', explicit: false }))
  h('app:set-measurement-unit', (u: any) => { set('measurementUnit', u === null ? { unit: 'in', explicit: false } : { unit: u, explicit: true }); return get('measurementUnit', null) })
  h('app:get-auto-save-default', () => get('autoSave', { on: true, updatedAt: 0 }))
  h('app:get-author-name', () => get('authorName', ''))
  h('app:get-csv-import-limit', () => 200)
  h('app:get-ai-panel-prefs', () => ({ ...DEFAULT_AI_PANEL_PREFS, ...get('aiPanelPrefs', {}) }))
  h('app:set-ai-panel-prefs', (p: any) => { const n = { ...get('aiPanelPrefs', {}), ...p }; set('aiPanelPrefs', n); return { ...DEFAULT_AI_PANEL_PREFS, ...n } })
  h('kb:list', () => [])
  h('ai:gsk-status', () => ({ available: false }))
}

// Unsaved changes when a tab closes or the app goes to the background.
// Each editor reports its unsaved state in its own way; the home asks __aeDirty() before closing a tab and, when the
// answer is yes, offers 저장 / 저장 안 함 / 취소 (or saves at once when autosave is on and the document has a file).
// __aeSave() runs the editor's own close-time save, which answers whether it saved (a new document asks its name;
// declining is "not saved"). When the app goes to the background, a document with a file is saved if autosave is on.
import { ipcMain, ipcRenderer, webContents } from './electron'
import { flush } from './fs'

const SAVE: Record<string, [string, string, any?]> = {
  docs: ['docs:close-save-request', 'docs:close-save-result'],
  slides: ['slides:close-save-request', 'slides:close-save-result'],
  sheets: ['workbook:close-save-request', 'workbook:close-save-result'],
  pdf: ['pdf:close-save-request', 'pdf:close-save-result', { flushAll: true }],
}
const autosaveOn = () => { try { return JSON.parse(localStorage.getItem('alleditor.settings') || '{}').autoSave?.on !== false } catch { return true } }

export function installCloseGuard(app: string) {
  const g: any = globalThis
  let dirty = false
  if (app === 'hwp') ipcMain.on('hwp:dirty-changed', (_e: any, d: unknown) => { dirty = d === true })
  if (app === 'pdf') ipcMain.on('pdf:dirty-changed', (_e: any, d: unknown) => { dirty = d === true })
  if (app === 'sheets') ipcMain.on('workbook:pending-edits', (_e: any, n: unknown) => { dirty = Number(n) > 0 })

  g.__aeDirty = async (): Promise<boolean> => {
    if (app === 'slides') { try { return (await ipcRenderer.invoke('slides:is-dirty')) === true } catch { return false } }
    if (app === 'docs') return new Promise<boolean>((done) => {
      const got = (_e: any, s: any) => { ipcMain.off('docs:close-check-result', got); clearTimeout(t); done(s?.dirty === true) }
      const t = setTimeout(() => { ipcMain.off('docs:close-check-result', got); done(false) }, 2000)
      ipcMain.on('docs:close-check-result', got)
      webContents.send('docs:close-check')
    })
    return dirty
  }

  const ch = SAVE[app]
  if (ch) g.__aeSave = (): Promise<boolean> => new Promise<boolean>((done) => {
    const got = async (_e: any, ok: unknown) => {
      ipcMain.off(ch[1], got); clearTimeout(t)
      if (ok === true) { try { await flush() } catch {} }
      done(ok === true)
    }
    const t = setTimeout(() => { ipcMain.off(ch[1], got); done(false) }, 180000) // a save may wait on its name prompt
    ipcMain.on(ch[1], got)
    if (ch[2] !== undefined) webContents.send(ch[0], ch[2]); else webContents.send(ch[0])
  })

  // the app goes to the background (or iPadOS may end it there): a document with a file is saved now
  let saving = false
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden || saving || !autosaveOn()) return
    const path = g.__aeDocPath?.()
    if (!path) { try { await flush() } catch {} ; return }
    saving = true
    try { if (await g.__aeDirty()) await g.__aeSave?.(); await flush() } catch {} finally { saving = false }
  })
}

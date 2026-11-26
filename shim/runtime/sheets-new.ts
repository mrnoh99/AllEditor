// A new spreadsheet, the way the desktop shell makes one (apps/shell newSheetTab): a blank workbook written to a
// temp folder (this page's memory only — /tmp is never mirrored to the device), marked "unsaved new" so its first
// Save goes through Save As (the name prompt, saved into Documents), then opened in the sheets view. Without the
// backing file the view had an in-memory grid that nothing could save.
import fs, { DOCS_ROOT } from './fs'

interface Deps {
  blankXlsxBuffer: () => Promise<Uint8Array>
  markSheetsUnsavedNew: (openPath: string, suggestSaveAs: string, tempDir: string) => void
  markSheetsUntitledPath: (path: string) => void
  queueWorkbookForView: (contents: unknown, path: string) => void
  setSheetsNewBlank: () => void
  webContents: unknown
}

export async function newBlankSheet(d: Deps) {
  try {
    const ko = (() => { try { return (JSON.parse(localStorage.getItem('alleditor.settings') || '{}').language ?? 'ko') !== 'en' } catch { return true } })()
    const stem = ko ? '스프레드시트' : 'Spreadsheet'
    let suggested = `${DOCS_ROOT}/${stem}.xlsx`
    for (let i = 2; fs.existsSync(suggested); i++) suggested = `${DOCS_ROOT}/${stem} ${i}.xlsx`
    const tempDir = `/tmp/ae-new-sheet-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    fs.mkdirSync(tempDir, { recursive: true })
    const backing = `${tempDir}/${suggested.slice(suggested.lastIndexOf('/') + 1)}`
    d.markSheetsUnsavedNew(backing, suggested, tempDir)
    fs.writeFileSync(backing, await d.blankXlsxBuffer())
    d.markSheetsUntitledPath(backing)
    d.queueWorkbookForView(d.webContents, backing)
  } catch (e) {
    console.warn('[sheets] blank backing workbook failed; in-memory blank sheet', e)
    d.setSheetsNewBlank()
  }
}

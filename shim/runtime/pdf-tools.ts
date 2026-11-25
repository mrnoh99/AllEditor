// PDF -> Word / Excel / PowerPoint, fully on-device (PDFium wasm). On desktop these handlers
// live in the Electron shell; here they write the result into Documents and offer to open it.
import { ipcMain } from './electron'
import fs, { DOCS_ROOT } from './fs'
import { convertPdfFileToDocxLocal } from '@upstream/apps/shell/src/main/pdf2docx-local'
import { convertPdfFileToPptxLocal } from '@upstream/apps/shell/src/main/pdf2pptx-local'
import { convertPdfFileToXlsxLocal } from '@upstream/apps/shell/src/main/pdf2xlsx-local'

const uniq = (p: string) => {
  const dot = p.lastIndexOf('.'); const stem = p.slice(0, dot), ext = p.slice(dot)
  let out = p, i = 1
  while (fs.existsSync(out)) out = `${stem} ${i++}${ext}`
  return out
}

export function registerPdfTools(openPath: string | null) {
  ipcMain.handle('pdf:convert-office', async (_e: any, format: string) => {
    if (!openPath) { alert('Open a PDF first.'); return }
    const stem = openPath.replace(/\.pdf$/i, '')
    try {
      let data: Uint8Array, ext: string, app: string
      if (format === 'docx') { data = (await convertPdfFileToDocxLocal(openPath)).docx; ext = 'docx'; app = 'docs' }
      else if (format === 'pptx') { data = (await convertPdfFileToPptxLocal(openPath)).pptx; ext = 'pptx'; app = 'slides' }
      else if (format === 'xlsx') { data = (await convertPdfFileToXlsxLocal(openPath)).xlsx; ext = 'xlsx'; app = 'sheets' }
      else { alert(`Export as ${format} is not available in the iOS build yet.`); return }
      const out = uniq(`${stem}.${ext}`)
      fs.writeFileSync(out, data)
      await new Promise((r) => setTimeout(r, 400)) // let the Documents mirror flush
      if (confirm(`Saved ${out.replace(DOCS_ROOT + '/', '')} in Files › AllEditor.\n\nOpen it now?`))
        location.href = `../${app}/index.html?open=${encodeURIComponent(out)}`
    } catch (e: any) {
      alert(`Conversion failed: ${e?.message ?? e}`)
    }
  })
}

// PDF -> Word / Excel / PowerPoint, fully on-device (PDFium wasm). On desktop these handlers
// live in the Electron shell; here they write the result into Documents and offer to open it.
import { ipcMain } from './electron'
import fs, { DOCS_ROOT } from './fs'
import { sendToPrinter } from './print'
import { PDFDocument } from 'pdf-lib'
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
  // pdf:print-file — the PDF app prints the file itself (desktop: CUPS `lp`); here: straight to the chosen printer
  ipcMain.handle('pdf:print-file', async (_e: any, req: any) => {
    try {
      const path = String(req?.path ?? openPath ?? '')
      let bytes = new Uint8Array(fs.readFileSync(path))
      if (Array.isArray(req?.pages) && req.pages.length) {
        const src = await PDFDocument.load(bytes); const dst = await PDFDocument.create()
        const idx = req.pages.map((n: number) => n - 1).filter((i: number) => i >= 0 && i < src.getPageCount())
        for (const pg of await dst.copyPages(src, idx)) dst.addPage(pg)
        bytes = await dst.save()
      }
      const done = await sendToPrinter(bytes, { deviceName: req?.deviceName ?? undefined, copies: req?.copies, duplexMode: req?.duplexMode }, path.split('/').pop() || 'PDF')
      return done ? { ok: true } : { ok: false }
    } catch (e: any) { return { ok: false, error: String(e?.message ?? e) } }
  })

  ipcMain.handle('pdf:convert-office', async (_e: any, format: string) => {
    if (!openPath) { alert('먼저 PDF를 여세요.'); return }
    const stem = openPath.replace(/\.pdf$/i, '')
    try {
      let data: Uint8Array, ext: string, app: string
      if (format === 'docx') { data = (await convertPdfFileToDocxLocal(openPath)).docx; ext = 'docx'; app = 'docs' }
      else if (format === 'pptx') { data = (await convertPdfFileToPptxLocal(openPath)).pptx; ext = 'pptx'; app = 'slides' }
      else if (format === 'xlsx') { data = (await convertPdfFileToXlsxLocal(openPath)).xlsx; ext = 'xlsx'; app = 'sheets' }
      else { alert(`${format} 내보내기는 iOS 버전에서 아직 지원하지 않습니다.`); return }
      const out = uniq(`${stem}.${ext}`)
      fs.writeFileSync(out, data)
      await new Promise((r) => setTimeout(r, 400)) // let the Documents mirror flush
      if (confirm(`${out.replace(DOCS_ROOT + '/', '')} 파일을 파일 앱 › AllEditor에 저장했습니다.\n\n지금 열까요?`))
        location.href = `../${app}/index.html?open=${encodeURIComponent(out)}`
    } catch (e: any) {
      alert(`변환 실패: ${e?.message ?? e}`)
    }
  })
}

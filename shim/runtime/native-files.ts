// Thin JS side of AEFilesPlugin (ios/App/App/AppDelegate.swift); same shape as @capacitor/filesystem.
// Directory.Documents = app Documents (visible in Files.app); Directory.Support = private app data.
import { registerPlugin } from '@capacitor/core'

type Dir = 'documents' | 'support'
interface AEFiles {
  readFile(o: { path: string; dir: Dir }): Promise<{ data: string }>
  writeFile(o: { path: string; data: string; dir: Dir }): Promise<void>
  deleteFile(o: { path: string; dir: Dir }): Promise<void>
  readdir(o: { path: string; dir: Dir }): Promise<{ files: Array<{ name: string; type: string; size: number; mtime: number }> }>
}
const plugin = registerPlugin<AEFiles>('AEFiles')

export const Directory = { Documents: 'documents', Support: 'support' } as const
type D = (typeof Directory)[keyof typeof Directory]
const dir = (d?: string): Dir => (d === 'support' ? 'support' : 'documents')
export const Filesystem = {
  readFile: (o: { path: string; directory?: D }) => plugin.readFile({ path: o.path, dir: dir(o.directory) }),
  writeFile: (o: { path: string; directory?: D; data: string; recursive?: boolean }) => plugin.writeFile({ path: o.path, data: o.data, dir: dir(o.directory) }),
  deleteFile: (o: { path: string; directory?: D }) => plugin.deleteFile({ path: o.path, dir: dir(o.directory) }),
  readdir: (o: { path: string; directory?: D }) => plugin.readdir({ path: o.path, dir: dir(o.directory) }),
}

// ---- AEPdf: HTML -> PDF through an offscreen WKWebView + UIPrintPageRenderer (AppDelegate.swift) ----
interface AEPdf { render(o: { html: string; width: number; height: number }): Promise<{ data: string }> }
const pdfPlugin = registerPlugin<AEPdf>('AEPdf')
/** page size in points; returns the PDF bytes */
export async function renderPdfNative(html: string, widthPt: number, heightPt: number): Promise<Uint8Array> {
  const { data } = await pdfPlugin.render({ html, width: widthPt, height: heightPt })
  const bin = atob(data); const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

// ---- AEPrint: iOS print dialog and direct network printing (IPP / raw 9100) ----
interface AEPrint {
  printPdf(o: { data: string; jobName: string }): Promise<{ completed: boolean }>
  directPrint(o: { host: string; port?: number; protocol: string; data: string; jobName: string; copies?: number; sides?: string }): Promise<{ via: string }>
}
const printPlugin = registerPlugin<AEPrint>('AEPrint')
const toB64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
export const nativePrintDialog = (pdf: Uint8Array, jobName: string) => printPlugin.printPdf({ data: toB64(pdf), jobName })
export const nativeDirectPrint = (o: { host: string; port?: number; protocol: string; pdf: Uint8Array; jobName: string; copies?: number; sides?: string }) =>
  printPlugin.directPrint({ host: o.host, port: o.port, protocol: o.protocol, data: toB64(o.pdf), jobName: o.jobName, copies: o.copies, sides: o.sides })

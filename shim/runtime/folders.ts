// Inside the AllEditor folder, documents are kept in one folder per kind: 한글 · Word · PowerPoint · Excel · PDF ·
// iWork. New documents (save, import, a converted copy) go into the folder of their kind; documents already at the
// top of AllEditor stay where they are and are still listed.
import fs, { DOCS_ROOT } from './fs'

const KIND_FOLDER: Record<string, string> = {
  hwp: '한글', hwpx: '한글',
  docx: 'Word', dotx: 'Word', doc: 'Word', dot: 'Word', odt: 'Word', ott: 'Word', rtf: 'Word',
  pptx: 'PowerPoint', potx: 'PowerPoint', ppt: 'PowerPoint', odp: 'PowerPoint', otp: 'PowerPoint',
  xlsx: 'Excel', xlsm: 'Excel', xls: 'Excel', ods: 'Excel', ots: 'Excel', csv: 'Excel', tsv: 'Excel',
  pdf: 'PDF',
  pages: 'iWork', key: 'iWork', keyx: 'iWork', numbers: 'iWork',
}
export const KIND_FOLDERS = [...new Set(Object.values(KIND_FOLDER))]
export const kindFolder = (name: string): string | null => KIND_FOLDER[name.split('.').pop()!.toLowerCase()] ?? null

/** the folder a document of this name belongs in (created when missing) */
export function folderFor(name: string): string {
  const k = kindFolder(name)
  const dir = k ? `${DOCS_ROOT}/${k}` : DOCS_ROOT
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return dir
}
/** a free path for this name in its kind's folder: "이름.docx", "이름 2.docx" … */
export function typedPath(name: string): string {
  const dir = folderFor(name)
  const dot = name.lastIndexOf('.'); const stem = dot > 0 ? name.slice(0, dot) : name, e = dot > 0 ? name.slice(dot) : ''
  let p = `${dir}/${name}`, i = 2
  while (fs.existsSync(p)) p = `${dir}/${stem} ${i++}${e}`
  return p
}
/** a path below the AllEditor folder as the lists name it: "Word/보고서.docx" (or "보고서.docx" at the top) */
export const relName = (path: string) => (path.startsWith(DOCS_ROOT + '/') ? path.slice(DOCS_ROOT.length + 1) : path.slice(path.lastIndexOf('/') + 1))

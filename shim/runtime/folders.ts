// Inside the AllEditor folder, documents are kept in one folder per kind: Hangul · Word · PowerPoint · Excel · PDF ·
// Pages · Numbers · Keynote (made at install by the app, AllEditorICloud.swift aeEnsureKindFolders; other kinds on their first file). New documents (save, import, a converted copy) go into the folder of their kind; documents already at the
// top of AllEditor stay where they are and are still listed.
import fs, { DOCS_ROOT } from './fs'

const KIND_FOLDER: Record<string, string> = {
  hwp: 'Hangul', hwpx: 'Hangul',
  docx: 'Word', dotx: 'Word', doc: 'Word', dot: 'Word', odt: 'Word', ott: 'Word', rtf: 'Word',
  pptx: 'PowerPoint', potx: 'PowerPoint', ppt: 'PowerPoint', odp: 'PowerPoint', otp: 'PowerPoint',
  xlsx: 'Excel', xlsm: 'Excel', xls: 'Excel', ods: 'Excel', ots: 'Excel', csv: 'Excel', tsv: 'Excel',
  pdf: 'PDF',
  pages: 'Pages', numbers: 'Numbers', key: 'Keynote', keyx: 'Keynote',
}
export const KIND_FOLDERS = [...new Set(Object.values(KIND_FOLDER))]
/** the folder of a document's kind; any other kind gets a folder named after its extension (RTF, TXT …),
 *  made just before its first file is saved */
export const kindFolder = (name: string): string | null => {
  const dot = name.lastIndexOf('.'); if (dot <= 0) return null
  const e = name.slice(dot + 1).toLowerCase()
  return KIND_FOLDER[e] ?? (/^[a-z0-9]{1,8}$/.test(e) ? e.toUpperCase() : null)
}

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

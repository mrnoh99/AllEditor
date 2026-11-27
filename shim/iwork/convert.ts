// Apple iWork (.pages / .key / .numbers) -> editable OOXML (.docx / .pptx / .xlsx).
// Parsing is done by `iwork-viewer/parser` (modern IWA + iWork '09); this file maps its scene model
// (text blocks, tables, images, charts, notes) onto OOXML. Text, tables, images and charts survive;
// formulas (Numbers keeps saved results only), animations and Pages' exact page layout do not.
import { parseIworkDocument } from 'iwork-viewer/parser'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { isKeyx, keyxToPptx } from './keyx'

export type IworkKind = 'pages' | 'keynote' | 'numbers'
export const IWORK_EXT: Record<string, IworkKind> = { pages: 'pages', key: 'keynote', keyx: 'keynote', numbers: 'numbers' }
export interface Converted { bytes: Uint8Array; ext: 'docx' | 'pptx' | 'xlsx'; notes: string[] }

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
const hex = (c?: string): string | undefined => {
  if (!c) return undefined
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c)
  if (m) return [m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase()
  const h = c.replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) return h.split('').map((x) => x + x).join('').toUpperCase()
  return /^[0-9a-f]{6,8}$/i.test(h) ? h.slice(0, 6).toUpperCase() : undefined
}
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
const pt = (px: number) => px / 72

export async function convertIwork(buf: ArrayBuffer, kind: IworkKind, parser?: () => any): Promise<Converted> {
  // Keynote Interchange Format (.keyx, Apple's documented JSON form): rebuilt exactly, not guessed
  if (kind === 'keynote') {
    let keyx = false
    try { keyx = isKeyx(await JSZip.loadAsync(buf)) != null } catch { /* not a ZIP: the binary .key reader below */ }
    if (keyx) { const r = await keyxToPptx(buf); return { bytes: r.bytes, ext: 'pptx', notes: r.notes } }
  }
  const doc: any = await parseIworkDocument(buf, kind, undefined, parser)
  const notes: string[] = [...(doc.limits ?? [])]
  if (!doc.scenes?.length) throw new Error('이 파일에서 내용을 읽지 못했습니다.')
  if (kind === 'keynote') return { bytes: await toPptx(doc), ext: 'pptx', notes }
  if (kind === 'numbers') return { bytes: await toXlsx(doc), ext: 'xlsx', notes: [...notes, '수식은 저장된 계산 결과 값으로 변환됩니다.'] }
  return { bytes: await toDocx(doc), ext: 'docx', notes: [...notes, '페이지 레이아웃은 흐름 문서로 변환됩니다.'] }
}

// ---------------------------------------------------------------- Keynote -> pptx
async function toPptx(doc: any): Promise<Uint8Array> {
  const P: any = (PptxGenJS as any).default ?? PptxGenJS
  const pptx = new P()
  const first = doc.scenes[0]
  pptx.defineLayout({ name: 'KEY', width: pt(first.width), height: pt(first.height) })
  pptx.layout = 'KEY'
  pptx.title = doc.title || 'Keynote'
  for (const scene of doc.scenes) {
    const slide = pptx.addSlide()
    const items: Array<{ z: number; draw: () => void }> = []
    scene.objects?.forEach((o: any, i: number) => items.push({ z: o.zIndex ?? i, draw: () => {
      const box = { x: pt(o.x), y: pt(o.y), w: Math.max(pt(o.width), 0.05), h: Math.max(pt(o.height), 0.05) }
      if (o.kind === 'image' && o.bytes) slide.addImage({ data: `data:${o.mimeType || 'image/png'};base64,${b64(o.bytes)}`, ...box, rotate: o.angle || 0 })
      else if (o.kind === 'chart' && o.chart) {
        const c = o.chart
        slide.addChart(c.type === 'line' ? pptx.charts.LINE : pptx.charts.BAR, c.series.map((s: any) => ({ name: s.name, labels: c.categories, values: s.values })), { ...box, showLegend: c.series.length > 1 })
      } else if (o.text) slide.addText(o.text, { ...box, fontSize: 14 })
    } }))
    scene.blocks?.forEach((b: any, i: number) => items.push({ z: b.zIndex ?? 1000 + i, draw: () => {
      const paras = b.paragraphs?.length ? b.paragraphs : [{ runs: [{ text: b.text }] }]
      const runs: any[] = []
      paras.forEach((p: any, pi: number) => (p.runs?.length ? p.runs : [{ text: '' }]).forEach((r: any, ri: number, arr: any[]) => runs.push({
        text: r.text,
        options: { bold: r.bold ?? p.bold ?? b.bold, italic: r.italic ?? p.italic ?? b.italic, color: hex(r.color ?? p.color ?? b.color), fontSize: b.fontSize, fontFace: b.fontFamily,
          bullet: p.bullet && ri === 0 ? true : undefined, breakLine: ri === arr.length - 1 && pi < paras.length - 1 },
      })))
      slide.addText(runs, { x: pt(b.x), y: pt(b.y), w: Math.max(pt(b.width), 0.3), h: Math.max(pt(b.height), 0.2), align: b.align, valign: b.verticalAlign,
        margin: b.padding ? [b.padding.left, b.padding.right, b.padding.bottom, b.padding.top] : 0, fontSize: b.fontSize, fontFace: b.fontFamily, color: hex(b.color), fit: 'none' })
    } }))
    scene.tables?.forEach((t: any, i: number) => items.push({ z: t.zIndex ?? 500 + i, draw: () => {
      if (!t.rows?.length) return
      const rows = t.rows.map((r: string[], ri: number) => r.map((c) => ({ text: c ?? '', options: ri < (t.headerRows ?? 0) ? { bold: true, fill: { color: hex(t.headerRowBackground) ?? 'EEEEEE' } } : {} })))
      slide.addTable(rows, { x: pt(t.x), y: pt(t.y), w: t.width ? pt(t.width) : undefined, colW: t.columnWidths?.map(pt), rowH: t.rowHeights?.map(pt), fontSize: t.fontSize ?? 14, fontFace: t.fontFamily, border: { type: 'solid', pt: 0.5, color: hex(t.borderColor) ?? 'BBBBBB' } })
    } }))
    items.sort((a, b) => a.z - b.z).forEach((it) => { try { it.draw() } catch (e) { console.warn('[iwork pptx]', e) } })
    if (scene.notes?.length) slide.addNotes(scene.notes.join('\n'))
  }
  return (await pptx.write({ outputType: 'uint8array' })) as Uint8Array
}

// ---------------------------------------------------------------- Numbers -> xlsx
const colName = (n: number) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const isNum = (s: string) => /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s.trim())

async function toXlsx(doc: any): Promise<Uint8Array> {
  const zip = new JSZip()
  const names: string[] = []
  const sheets: string[] = []
  doc.scenes.forEach((scene: any, si: number) => {
    let name = String(scene.name || `Sheet${si + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${si + 1}`
    while (names.includes(name)) name = (name.slice(0, 28) + ' ' + (si + 1)).slice(0, 31)
    names.push(name)
    const rows: string[] = []; const merges: string[] = []; const cols: number[] = []
    let r = 1
    const cell = (c: number, row: number, v: string) => {
      if (v === '' || v == null) return ''
      const ref = colName(c) + row
      return isNum(v) ? `<c r="${ref}"><v>${v.trim()}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
    }
    const flow = [
      ...(scene.blocks ?? []).map((b: any) => ({ y: b.y ?? 0, kind: 'text' as const, v: b })),
      ...(scene.tables ?? []).map((t: any) => ({ y: t.y ?? 0, kind: 'table' as const, v: t })),
    ].sort((a, b) => a.y - b.y)
    for (const it of flow) {
      if (it.kind === 'text') { const x = cell(0, r, String(it.v.text).replace(/\n+/g, ' ')); if (x) rows.push(`<row r="${r}">${x}</row>`); r += 1; continue }
      const t = it.v
      t.columnWidths?.forEach((w: number, i: number) => { cols[i] = Math.max(cols[i] ?? 0, w) })
      t.rows.forEach((row: string[], ri: number) => { rows.push(`<row r="${r + ri}">${row.map((v, ci) => cell(ci, r + ri, v)).join('')}</row>`) })
      t.merges?.forEach((m: any) => merges.push(`<mergeCell ref="${colName(m.col)}${r + m.row}:${colName(m.col + m.colspan - 1)}${r + m.row + m.rowspan - 1}"/>`))
      r += t.rows.length + 1
    }
    const colsXml = cols.length ? `<cols>${cols.map((w, i) => (w ? `<col min="${i + 1}" max="${i + 1}" width="${Math.max(6, Math.min(60, w / 5.5)).toFixed(1)}" customWidth="1"/>` : '')).join('')}</cols>` : ''
    sheets.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${colsXml}<sheetData>${rows.join('')}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}</worksheet>`)
  })
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`)
  sheets.forEach((x, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, x))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// ---------------------------------------------------------------- Pages -> docx
async function toDocx(doc: any): Promise<Uint8Array> {
  const zip = new JSZip()
  const media: Array<{ name: string; mime: string; bytes: Uint8Array }> = []
  const body: string[] = []
  const first = doc.scenes[0]
  const run = (r: any, base: any) => {
    const bold = r.bold ?? base.bold, italic = r.italic ?? base.italic, color = hex(r.color ?? base.color), sz = base.fontSize ? Math.round(base.fontSize * 2) : 0
    const props = `${base.fontFamily ? `<w:rFonts w:ascii="${esc(base.fontFamily)}" w:hAnsi="${esc(base.fontFamily)}" w:eastAsia="${esc(base.fontFamily)}"/>` : ''}${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : ''}`
    return String(r.text).split('\n').map((line, i) => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('')
  }
  const para = (runs: string, o: { align?: string; bullet?: boolean } = {}) =>
    `<w:p><w:pPr>${o.bullet ? '<w:ind w:left="360" w:hanging="360"/>' : ''}${o.align ? `<w:jc w:val="${o.align === 'center' ? 'center' : o.align === 'right' ? 'right' : 'left'}"/>` : ''}</w:pPr>${o.bullet ? '<w:r><w:t xml:space="preserve">•\t</w:t></w:r>' : ''}${runs}</w:p>`
  const table = (t: any) => {
    const skip = new Set<string>(); const spanAt = new Map<string, any>()
    t.merges?.forEach((m: any) => { spanAt.set(`${m.row},${m.col}`, m); for (let r = 0; r < m.rowspan; r++) for (let c = 0; c < m.colspan; c++) if (r || c) skip.add(`${m.row + r},${m.col + c}`) })
    const ncol = Math.max(...t.rows.map((r: string[]) => r.length), 1)
    const grid = Array.from({ length: ncol }, (_, i) => `<w:gridCol w:w="${Math.round((t.columnWidths?.[i] ?? 80) * 20)}"/>`).join('')
    const rows = t.rows.map((row: string[], ri: number) => `<w:tr>${row.map((v, ci) => {
      const m = spanAt.get(`${ri},${ci}`)
      if (skip.has(`${ri},${ci}`)) { const owner = [...spanAt.entries()].find(([k, mm]) => { const [r0, c0] = k.split(',').map(Number); return ri >= r0 && ri < r0 + mm.rowspan && ci >= c0 && ci < c0 + mm.colspan })?.[0]; const [r0, c0] = (owner ?? '0,0').split(',').map(Number); return c0 === ci ? `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>` : '' }
      const hdr = ri < (t.headerRows ?? 0)
      return `<w:tc><w:tcPr>${m?.colspan > 1 ? `<w:gridSpan w:val="${m.colspan}"/>` : ''}${m?.rowspan > 1 ? '<w:vMerge w:val="restart"/>' : ''}${hdr ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : ''}</w:tcPr>${para(run({ text: v ?? '' }, { bold: hdr, fontSize: t.fontSize }))}</w:tc>`
    }).join('')}</w:tr>`).join('')
    return `<w:tbl><w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl><w:p/>`
  }
  const image = (o: any) => {
    const n = media.length + 1, ext = /jpe?g/i.test(o.mimeType ?? '') ? 'jpeg' : /gif/i.test(o.mimeType ?? '') ? 'gif' : 'png'
    media.push({ name: `image${n}.${ext}`, mime: `image/${ext}`, bytes: o.bytes })
    const w = Math.round(Math.min(o.width || 200, 450) * 12700), h = Math.round(((o.height || 150) * Math.min(o.width || 200, 450)) / (o.width || 200) * 12700)
    return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${n}" name="Picture ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  }
  doc.scenes.forEach((scene: any, si: number) => {
    if (si > 0) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    const flow = [
      ...(scene.blocks ?? []).map((b: any) => ({ y: b.y ?? 0, x: b.x ?? 0, k: 'b', v: b })),
      ...(scene.tables ?? []).map((t: any) => ({ y: t.y ?? 0, x: t.x ?? 0, k: 't', v: t })),
      ...(scene.objects ?? []).filter((o: any) => (o.kind === 'image' && o.bytes) || ((o.kind === 'shape' || o.kind === 'media') && o.text)).map((o: any) => ({ y: o.y ?? 0, x: o.x ?? 0, k: 'o', v: o })),
    ].sort((a, b) => a.y - b.y || a.x - b.x)
    for (const it of flow) {
      if (it.k === 't' && it.v.rows?.length) body.push(table(it.v))
      else if (it.k === 'o') body.push(it.v.kind === 'image' ? image(it.v) : para(run({ text: it.v.text }, {})))
      else if (it.k === 'b') {
        const b = it.v
        const paras = b.paragraphs?.length ? b.paragraphs : String(b.text).split('\n').map((t: string) => ({ runs: [{ text: t }] }))
        for (const p of paras) body.push(para((p.runs?.length ? p.runs : [{ text: '' }]).map((r: any) => run(r, { ...b, ...p })).join(''), { align: b.align, bullet: p.bullet }))
      }
    }
  })
  const pw = Math.round((first.width || 595) * 20), ph = Math.round((first.height || 842) * 20)
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${media.map((m, i) => `<Relationship Id="rImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('')}</Relationships>`)
  media.forEach((m) => zip.file(`word/media/${m.name}`, m.bytes))
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

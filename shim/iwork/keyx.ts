// Keynote Interchange Format (.keyx) -> PowerPoint (.pptx).
// .keyx is Apple's documented JSON form of a Keynote presentation (developer.apple.com/documentation/keynoteinterchangeformat):
// a ZIP with main.json (the Presentation), presets.json (shared property sets), manifest.json and Data/ (media).
// Unlike the binary .key, every position, size, rotation, crop, text style and z-order is written out, so the
// slides are rebuilt exactly instead of guessed. Units: points (72/inch), origin top-left, y down; rotation in degrees
// counterclockwise about the centre; `position` is the top-left of the rotated bounding box, `size` the unrotated size;
// positions are absolute on the slide, also inside groups.
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { pdfToPng } from './pdf-image'

const IN = (p: number) => (Number.isFinite(p) ? p / 72 : 0)
type J = any
const META = new Set(['type_identifier', 'version', 'preset_identifier'])
const isObj = (v: unknown): v is Record<string, J> => !!v && typeof v === 'object' && !Array.isArray(v)
const formKeys = (o: Record<string, J>) => Object.keys(o).filter((k) => !META.has(k))

/** b over a. A union value (one key naming its form: fill.color / fill.gradient …) whose form differs replaces a. */
function merge(a: J, b: J): J {
  if (b === undefined) return a
  if (!isObj(a) || !isObj(b)) return b
  const ka = formKeys(a), kb = formKeys(b)
  if (ka.length === 1 && kb.length === 1 && ka[0] !== kb[0] && a.type_identifier && a.type_identifier === b.type_identifier) return b
  const out: Record<string, J> = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? merge(a[k], v) : v
  return out
}

class Ctx {
  presets = new Map<string, J>()
  notes = new Set<string>()
  media = new Map<string, string | null>()
  constructor(public zip: JSZip, public base: string) {}
  presetProps(id: string, seen = new Set<string>()): J {
    const p = this.presets.get(id)
    if (!p || seen.has(id)) return {}
    seen.add(id)
    return merge(p.parent_identifier ? this.presetProps(p.parent_identifier, seen) : {}, p.properties ?? {})
  }
  /** every object with a preset_identifier takes the preset's properties as its defaults (object > preset > parents) */
  resolve(x: J, depth = 0): J {
    if (depth > 60) return x
    if (Array.isArray(x)) return x.map((v) => this.resolve(v, depth + 1))
    if (!isObj(x)) return x
    let o: J = x
    if (typeof o.preset_identifier === 'string' && this.presets.has(o.preset_identifier)) o = merge(this.presetProps(o.preset_identifier), o)
    const out: Record<string, J> = {}
    for (const [k, v] of Object.entries(o)) out[k] = this.resolve(v, depth + 1)
    return out
  }
  file(name: string) {
    return this.zip.file(this.base + 'Data/' + name) ?? this.zip.file(this.base + name)
      ?? Object.values(this.zip.files).find((f) => !f.dir && f.name.endsWith('/' + name)) ?? null
  }
  /** a Resource as a data URL PowerPoint can show (PNG / JPEG / GIF; other formats redrawn as PNG), or null */
  async image(res: J): Promise<string | null> {
    if (!isObj(res)) return null
    let name = '', bytes: Uint8Array | null = null
    if (isObj(res.base64_encoded)) {
      name = String(res.base64_encoded.filename ?? 'image.png')
      const bin = atob(String(res.base64_encoded.string ?? '')); bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    } else if (isObj(res.indirect)) {
      name = String(res.indirect.filename ?? '')
      const key = String(res.indirect.identifier ?? name)
      if (this.media.has(key)) return this.media.get(key)!
      const f = this.file(key) ?? this.file(name)
      if (f) bytes = await f.async('uint8array')
      const url = bytes ? await toWebImage(bytes, name) : null
      if (!url) this.notes.add('일부 그림 형식은 변환하지 못했습니다.')
      this.media.set(key, url)
      return url
    }
    if (!bytes) return null
    const url = await toWebImage(bytes, name)
    if (!url) this.notes.add('일부 그림 형식은 변환하지 못했습니다.')
    return url
  }
}

const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
function sniff(u: Uint8Array, name: string): string {
  if (u[0] === 0x89 && u[1] === 0x50) return 'image/png'
  if (u[0] === 0xff && u[1] === 0xd8) return 'image/jpeg'
  if (u[0] === 0x47 && u[1] === 0x49) return 'image/gif'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return ({ heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', pdf: 'application/pdf' } as Record<string, string>)[ext] ?? 'application/octet-stream'
}
/** PNG / JPEG / GIF as they are; anything the web view can decode (HEIC, TIFF, WebP, SVG …) redrawn as PNG */
async function toWebImage(u: Uint8Array, name: string): Promise<string | null> {
  const mime = sniff(u, name)
  if (/png|jpeg|gif/.test(mime)) return `data:${mime};base64,${b64(u)}`
  if (mime === 'application/pdf' || (u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46)) return pdfToPng(u)
  try {
    const blob = new Blob([u as unknown as BlobPart], { type: mime })
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image(); img.src = url; await img.decode()
      const c = document.createElement('canvas'); c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1
      c.getContext('2d')!.drawImage(img, 0, 0)
      return c.toDataURL('image/png')
    } finally { URL.revokeObjectURL(url) }
  } catch { return null }
}

/** the part of a picture inside a frame (fractions of the picture's size) as a new PNG */
async function cropImage(url: string, fx: number, fy: number, fw: number, fh: number): Promise<string | null> {
  try {
    const img = new Image(); img.src = url; await img.decode()
    const W = img.naturalWidth, H = img.naturalHeight
    const sx = Math.max(0, fx * W), sy = Math.max(0, fy * H), sw = Math.min(W - sx, fw * W), sh = Math.min(H - sy, fh * H)
    if (sw < 1 || sh < 1) return null
    const c = document.createElement('canvas'); c.width = Math.round(sw); c.height = Math.round(sh)
    c.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height)
    return c.toDataURL(url.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png', 0.92)
  } catch { return null }
}

// ---------------------------------------------------------------- colours, geometry
function rgba(c: J): { color: string; transparency: number } | null {
  const v = isObj(c) ? (c.rgba ?? c) : null
  if (!isObj(v) || !('red' in v || 'green' in v || 'blue' in v)) return null
  const h = (x: J) => Math.round(Math.min(1, Math.max(0, Number(x ?? 0))) * 255).toString(16).padStart(2, '0')
  return { color: (h(v.red) + h(v.green) + h(v.blue)).toUpperCase(), transparency: Math.round((1 - Math.min(1, Math.max(0, Number(v.alpha ?? 1)))) * 100) }
}
function fillColor(f: J): { color: string; transparency: number } | null {
  if (!isObj(f)) return null
  if (f.color) return rgba(f.color)
  if (isObj(f.gradient) && Array.isArray(f.gradient.stops) && f.gradient.stops.length) {
    const s = f.gradient.stops; return rgba(s[Math.floor(s.length / 2)]?.color) // the mid colour of the gradient
  }
  return null
}
interface Box { x: number; y: number; w: number; h: number; rotate: number; flipH: boolean }
/** Keynote geometry -> PowerPoint frame: unrotated box (top-left of the rotated bounding box -> of the shape itself) */
function box(g: J): Box | null {
  if (!isObj(g) || !isObj(g.position) || !isObj(g.size)) return null
  const w = Number(g.size.width) || 0, h = Number(g.size.height) || 0, a = Number(g.angle) || 0
  const r = (a * Math.PI) / 180, bw = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r)), bh = Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r))
  const cx = Number(g.position.x) + bw / 2, cy = Number(g.position.y) + bh / 2
  return { x: cx - w / 2, y: cy - h / 2, w, h, rotate: ((360 - a) % 360 + 360) % 360, flipH: !!g.flip_horizontally }
}
const frame = (b: Box) => ({ x: IN(b.x), y: IN(b.y), w: Math.max(IN(b.w), 0.01), h: Math.max(IN(b.h), 0.01), ...(b.rotate ? { rotate: b.rotate } : {}), ...(b.flipH ? { flipH: true } : {}) })

function strokeOf(s: J): J | undefined {
  if (s === 'empty' || s == null) return undefined
  if (isObj(s) && isObj(s.line)) {
    const c = rgba(s.line.color) ?? { color: '000000', transparency: 0 }
    const pat = String(s.line.pattern ?? 'solid')
    return { color: c.color, transparency: c.transparency, width: Number(s.line.width ?? 1), ...(pat.includes('dash') ? { dashType: pat === 'short_dash' ? 'sysDash' : pat === 'round_dash' ? 'sysDot' : 'dash' } : {}) }
  }
  if (isObj(s) && s.frame) return { color: '808080', width: 1 }
  return undefined
}

// ---------------------------------------------------------------- text
const FONT_FAMILY: Record<string, string> = {
  HelveticaNeue: 'Helvetica Neue', AppleSDGothicNeo: 'Apple SD Gothic Neo', AppleMyungjo: 'AppleMyungjo', AppleGothic: 'AppleGothic',
  NanumGothic: 'NanumGothic', NanumMyeongjo: 'NanumMyeongjo', TimesNewRomanPS: 'Times New Roman', ArialMT: 'Arial', 'Arial': 'Arial',
  GillSans: 'Gill Sans', AvenirNext: 'Avenir Next', SFPro: 'SF Pro', '.SFUI': 'SF Pro', Georgia: 'Georgia', Futura: 'Futura', Baskerville: 'Baskerville',
}
/** a PostScript name (HelveticaNeue-Bold) -> family + weight/slant PowerPoint understands */
function font(name: J): { face?: string; bold?: boolean; italic?: boolean } {
  if (typeof name !== 'string' || !name) return {}
  const [fam, style = ''] = name.split('-')
  const face = FONT_FAMILY[fam] ?? fam.replace(/MT$|PSMT$|PS$/, '')
  return { face, ...(/bold|black|heavy|semibold/i.test(style) ? { bold: true } : {}), ...(/italic|oblique/i.test(style) ? { italic: true } : {}) }
}
function charOpts(cp: J): J {
  if (!isObj(cp)) return {}
  const f = font(cp.font_name)
  const fill = isObj(cp.character_fill) ? fillColor(cp.character_fill) : null
  const o: J = {}
  if (f.face) o.fontFace = f.face
  if (cp.font_size != null) o.fontSize = Number(cp.font_size)
  if (cp.bold != null) o.bold = !!cp.bold; else if (f.bold) o.bold = true
  if (cp.italic != null) o.italic = !!cp.italic; else if (f.italic) o.italic = true
  if (cp.underline && cp.underline !== 'none') o.underline = { style: cp.underline === 'double' ? 'dbl' : cp.underline === 'wavy' ? 'wavy' : 'sng' }
  if (cp.strikethrough && cp.strikethrough !== 'none') o.strike = cp.strikethrough === 'double' ? 'dblStrike' : 'sngStrike'
  if (cp.baseline === 'superscript') o.superscript = true
  if (cp.baseline === 'subscript') o.subscript = true
  if (fill) { o.color = fill.color; if (fill.transparency) o.transparency = fill.transparency }
  if (cp.tracking != null && cp.font_size) o.charSpacing = Number(cp.tracking) * Number(cp.font_size)
  return o
}
const ALIGN: Record<string, string> = { left: 'left', center: 'center', right: 'right', justified: 'justify', natural: 'left' }
function paraOpts(pp: J, list: J, level: number): J {
  const o: J = {}
  if (!isObj(pp)) pp = {}
  if (pp.alignment && ALIGN[pp.alignment]) o.align = ALIGN[pp.alignment]
  if (pp.space_before != null) o.paraSpaceBefore = Number(pp.space_before)
  if (pp.space_after != null) o.paraSpaceAfter = Number(pp.space_after)
  const ls = pp.line_spacing
  if (isObj(ls) && ls.value != null) {
    if (!ls.kind || ls.kind === 'relative') o.lineSpacingMultiple = Number(ls.value)
    else if (ls.kind === 'exact' || ls.kind === 'minimum') o.lineSpacing = Number(ls.value)
  }
  const lv = isObj(list) && Array.isArray(list.levels) ? list.levels[Math.min(level, list.levels.length - 1)] : null
  const label = lv?.label
  const left = Number(pp.left_indent ?? 0) || 0
  const size = Number(pp.character_properties?.font_size ?? 18) || 18
  if (label && label !== 'none' && label !== 'null_image') {
    // hanging indent: the label at the left, the text where Keynote puts it (at least a label's width further)
    const hang = Math.max(size * 1.2, Number(lv.text_indent ?? 0) - Number(lv.label_indent ?? 0))
    const base = Math.max(left, Number(lv.label_indent ?? 0))
    if (isObj(label.number)) o.bullet = { type: 'number', indent: base + hang }
    else if (isObj(label.string) && label.string.string) o.bullet = { characterCode: label.string.string.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'), indent: base + hang }
    else o.bullet = { indent: base + hang }
  } else if (Math.max(left, Number(lv?.label_indent ?? 0) || 0) > 0) {
    // a list level without a label still sets where its text starts (label_indent), as the paragraph's own indent does
    const at = Math.max(left, Number(lv?.label_indent ?? 0) || 0)
    o.bullet = { characterCode: '200B', indent: at }
    return o
  } else if (left > 0) {
    // an indented paragraph without a label: PowerPoint keeps a left margin only on list paragraphs, so the
    // paragraph gets an invisible label (zero-width space) whose hang is the indent
    o.bullet = { characterCode: '200B', indent: left }
  }
  return o
}
/** a Text (string / text_runs / paragraphs) -> PptxGenJS runs, paragraph options repeated on each run of a paragraph */
function textRuns(text: J, defPara: J): { runs: J[]; plain: string } {
  const paras: Array<{ pp: J; list: J; level: number; runs: Array<{ s: string; cp: J }> }> = []
  const dpp = isObj(defPara) ? defPara : {}
  if (!isObj(text)) return { runs: [], plain: '' }
  const split = (runs: Array<{ s: string; cp: J }>, pp: J) => {
    let cur: Array<{ s: string; cp: J }> = []
    for (const r of runs) {
      const parts = r.s.replace(/\r\n?/g, '\n').split(/\n|\u2029/)
      parts.forEach((p, i) => { if (i > 0) { paras.push({ pp, list: null, level: 0, runs: cur }); cur = [] } if (p) cur.push({ s: p, cp: r.cp }) })
    }
    paras.push({ pp, list: null, level: 0, runs: cur })
  }
  if (typeof text.string === 'string') split([{ s: text.string, cp: {} }], dpp)
  else if (Array.isArray(text.text_runs)) split(text.text_runs.map((r: J) => ({ s: String(r?.string ?? ''), cp: r?.style ?? {} })), dpp)
  else if (Array.isArray(text.paragraphs)) {
    for (const p of text.paragraphs) {
      const pp = merge(dpp, p?.style ?? {})
      const runs: Array<{ s: string; cp: J }> = []
      for (const c of p?.contents ?? []) {
        const r = c?.run ?? c?.hyperlink?.run
        if (r) runs.push({ s: String(r.string ?? '').replace(/\u2028/g, '\n'), cp: r.style ?? {} })
      }
      paras.push({ pp, list: p?.list_style ?? null, level: Number(p?.list_level ?? 0), runs, ...(p?.list_start != null ? { start: p.list_start } : {}) } as J)
    }
  }
  const out: J[] = []
  // numbered lists: Keynote keeps counting across the unnumbered lines under an item; PowerPoint restarts after
  // any other paragraph, so each numbered paragraph is given its own start number
  const count: number[] = []
  paras.forEach((p, pi) => {
    const po = paraOpts(p.pp, p.list, p.level)
    if (po.bullet?.type === 'number') {
      const L = p.level
      count.length = Math.max(count.length, L + 1)
      count[L] = (p as J).start != null ? Number((p as J).start) : (count[L] ?? 0) + 1
      count.length = L + 1 // deeper levels start again
      po.bullet = { ...po.bullet, numberStartAt: count[L] }
    } else if (p.runs.some((r) => r.s.trim())) count.length = Math.min(count.length, p.level) // a plain line at this level ends the list
    const base = p.pp?.character_properties ?? {}
    const runs = p.runs.length ? p.runs : [{ s: '', cp: {} }]
    runs.forEach((r, ri) => out.push({ text: r.s, options: { ...po, ...charOpts(merge(base, r.cp)), ...(ri === runs.length - 1 && pi < paras.length - 1 ? { breakLine: true } : {}) } }))
  })
  return { runs: out, plain: paras.map((p) => p.runs.map((r) => r.s).join('')).join('\n') }
}
/** width_valid false: the box takes the natural width of its text (Keynote's auto-sizing text box) and the stored width
 *  is stale. The text stays on its lines at its own size; the box is widened to the measured width (kept centred or
 *  right-aligned when the text is). Returns true when the lines must not wrap. */
let measureCtx: CanvasRenderingContext2D | null = null
function naturalWidth(runs: J[], o: J, b: Box): boolean {
  try {
    measureCtx ??= document.createElement('canvas').getContext('2d')
    if (!measureCtx) return false
    const pad = o.layout_properties?.padding
    const pads = pad ? Number(pad.left ?? 0) + Number(pad.right ?? 0) : 8
    let widest = 0, line = 0, align = 'left'
    for (const r of runs) {
      const op = r.options ?? {}
      if (op.align) align = op.align
      measureCtx.font = `${op.italic ? 'italic ' : ''}${op.bold ? 'bold ' : ''}${op.fontSize ?? 18}px "${op.fontFace ?? 'Helvetica Neue'}", sans-serif`
      line += measureCtx.measureText(String(r.text ?? '')).width
      if (op.breakLine) { widest = Math.max(widest, line); line = 0 }
    }
    widest = Math.max(widest, line)
    const need = widest * 1.04 + pads
    if (need > b.w) {
      const grow = need - b.w
      if (align === 'center') b.x -= grow / 2
      else if (align === 'right') b.x -= grow
      b.w = need
    }
    return true
  } catch { return false }
}
function textFrame(o: J): J {
  const lp = isObj(o.layout_properties) ? o.layout_properties : {}
  const pad = isObj(lp.padding) ? lp.padding : null
  const va = lp.vertical_alignment
  return {
    margin: pad ? [Number(pad.left ?? 0), Number(pad.right ?? 0), Number(pad.bottom ?? 0), Number(pad.top ?? 0)] : [4, 4, 4, 4],
    valign: va === 'center' ? 'middle' : va === 'bottom' ? 'bottom' : 'top',
    ...(lp.shrink_to_fit ? { fit: 'shrink' } : {}),
    wrap: true,
  }
}

// ---------------------------------------------------------------- shapes
/** SVG path data -> PptxGenJS custGeom points (inches within the shape's box) */
function pathPoints(d: string, space: J, w: number, h: number): J[] | null {
  const tok = d.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g)
  if (!tok) return null
  // `space` is a Rect (position + size); the path is stretched from it over the object's box
  const sx = isObj(space) ? Number(space.position?.x ?? 0) : 0, sy = isObj(space) ? Number(space.position?.y ?? 0) : 0
  const sw = isObj(space) ? Number(space.size?.width ?? w) || w : w, sh = isObj(space) ? Number(space.size?.height ?? h) || h : h
  const X = (v: number) => IN(((v - sx) / sw) * w), Y = (v: number) => IN(((v - sy) / sh) * h)
  const pts: J[] = []
  let i = 0, cmd = '', cx = 0, cy = 0, startX = 0, startY = 0
  const num = () => Number(tok[i++])
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++]
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase()
    if (C === 'Z') { pts.push({ close: true }); cx = startX; cy = startY; continue }
    if (C === 'M') { const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0); pts.push({ x: X(x), y: Y(y), moveTo: true }); cx = startX = x; cy = startY = y; cmd = rel ? 'l' : 'L'; continue }
    if (C === 'L') { const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0); pts.push({ x: X(x), y: Y(y) }); cx = x; cy = y; continue }
    if (C === 'H') { const x = num() + (rel ? cx : 0); pts.push({ x: X(x), y: Y(cy) }); cx = x; continue }
    if (C === 'V') { const y = num() + (rel ? cy : 0); pts.push({ x: X(cx), y: Y(y) }); cy = y; continue }
    if (C === 'C') { const a = [num(), num(), num(), num(), num(), num()].map((v, k) => v + (rel ? (k % 2 ? cy : cx) : 0)); pts.push({ x: X(a[4]), y: Y(a[5]), curve: { type: 'cubic', x1: X(a[0]), y1: Y(a[1]), x2: X(a[2]), y2: Y(a[3]) } }); cx = a[4]; cy = a[5]; continue }
    if (C === 'Q') { const a = [num(), num(), num(), num()].map((v, k) => v + (rel ? (k % 2 ? cy : cx) : 0)); pts.push({ x: X(a[2]), y: Y(a[3]), curve: { type: 'quadratic', x1: X(a[0]), y1: Y(a[1]) } }); cx = a[2]; cy = a[3]; continue }
    // S, T, A: rare in Keynote output; continue as straight segments to their end point
    const n = C === 'A' ? 7 : C === 'S' ? 4 : 2
    const a = Array.from({ length: n }, () => num()); const x = a[n - 2] + (rel ? cx : 0), y = a[n - 1] + (rel ? cy : 0)
    pts.push({ x: X(x), y: Y(y) }); cx = x; cy = y
  }
  return pts.length ? pts : null
}
/** a closed 4-corner axis-aligned path is a plain rectangle */
function isRect(pts: J[] | null): boolean {
  if (!pts) return true
  const p = pts.filter((q) => !q.close)
  if (p.some((q) => q.curve)) return false
  if (p.length < 4 || p.length > 5) return false
  const xs = new Set(p.map((q) => q.x.toFixed(3))), ys = new Set(p.map((q) => q.y.toFixed(3)))
  return xs.size === 2 && ys.size === 2
}

// ---------------------------------------------------------------- objects
async function draw(ctx: Ctx, pptx: J, slide: J, obj: J): Promise<void> {
  if (!isObj(obj)) return
  const [kind] = formKeys(obj)
  const o = obj[kind]
  if (!isObj(o)) return
  if (kind === 'group') { for (const c of o.children ?? []) await draw(ctx, pptx, slide, c); return }
  const b = box(o.geometry)
  if (kind === 'textbox' || kind === 'shape') {
    if (!b) return
    const fill = fillColor(o.fill)
    const line = strokeOf(o.stroke)
    const op = o.opacity != null ? Number(o.opacity) : 1
    const fillOpt = fill ? { fill: { color: fill.color, transparency: Math.max(fill.transparency, Math.round((1 - op) * 100)) } } : {}
    const tr = textRuns(o.text, o.paragraph_properties)
    const hasText = tr.plain.trim().length > 0
    let noWrap = false
    if (hasText && o.geometry?.width_valid === false) noWrap = naturalWidth(tr.runs, o, b)
    const common = { ...frame(b), ...fillOpt, ...(line ? { line } : {}), ...(hasText ? textFrame(o) : {}), ...(noWrap ? { wrap: false } : {}), ...(hasText && o.geometry?.height_valid === false ? { valign: 'top' } : {}) }
    if (kind === 'shape') {
      const p = isObj(o.path) && isObj(o.path.bezier) ? o.path.bezier : null
      const pts = p ? pathPoints(String(p.path ?? ''), p.space, b.w, b.h) : null
      const shapeType = isRect(pts) ? pptx.ShapeType.rect : pptx.ShapeType.custGeom
      if (!fill && !line && !hasText) return
      if (hasText) slide.addText(tr.runs, { ...common, shape: shapeType, ...(shapeType === pptx.ShapeType.custGeom ? { points: pts } : {}) })
      else slide.addShape(shapeType, { ...common, ...(shapeType === pptx.ShapeType.custGeom ? { points: pts } : {}) })
      return
    }
    if (hasText || fill || line) slide.addText(tr.runs.length ? tr.runs : '', common)
    return
  }
  if (kind === 'image') {
    const url = await ctx.image(o.resource)
    if (!url || !b) return
    const op = o.opacity != null ? Number(o.opacity) : 1
    const extra = { ...(op < 1 ? { transparency: Math.round((1 - op) * 100) } : {}), ...(b.rotate ? { rotate: b.rotate } : {}), ...(b.flipH ? { flipH: true } : {}) }
    const m = isObj(o.mask) ? box(o.mask.geometry) : null
    if (m && (Math.abs(m.x - b.x) > 0.5 || Math.abs(m.y - b.y) > 0.5 || Math.abs(m.w - b.w) > 0.5 || Math.abs(m.h - b.h) > 0.5)) {
      // the image is placed by its own geometry; the mask frame is what shows. The picture itself is cut to that
      // frame (a PowerPoint crop setting is not drawn by every viewer, the slide editor included)
      const cut = await cropImage(url, (m.x - b.x) / b.w, (m.y - b.y) / b.h, m.w / b.w, m.h / b.h)
      slide.addImage({ data: cut ?? url, ...frame({ ...m, flipH: b.flipH }), ...(op < 1 ? { transparency: Math.round((1 - op) * 100) } : {}) })
    } else slide.addImage({ data: url, x: IN(b.x), y: IN(b.y), w: Math.max(IN(b.w), 0.01), h: Math.max(IN(b.h), 0.01), ...extra })
    return
  }
  if (kind === 'movie') {
    const url = o.poster_image ? await ctx.image(o.poster_image) : null
    if (url && b) slide.addImage({ data: url, ...frame(b) })
    ctx.notes.add('동영상은 첫 장면 그림으로만 옮겨집니다.')
    return
  }
  if (kind === 'table') { if (b) drawTable(slide, o, b); return }
  if (kind === 'chart') { // the geometry sits inside the chart's type: chart.column.geometry
    const [ct] = formKeys(o); const cb = box(o[ct]?.geometry)
    if (cb) drawChart(ctx, pptx, slide, o, cb)
    return
  }
  if (kind === 'connectionLine') {
    const h = o.head?.end_point, t = o.tail?.end_point
    if (!isObj(h) || !isObj(t)) return
    const x1 = Number(t.x), y1 = Number(t.y), x2 = Number(h.x), y2 = Number(h.y)
    const line = strokeOf(o.stroke) ?? { color: '000000', width: 1 }
    slide.addShape(pptx.ShapeType.line, { x: IN(Math.min(x1, x2)), y: IN(Math.min(y1, y2)), w: Math.max(IN(Math.abs(x2 - x1)), 0.001), h: Math.max(IN(Math.abs(y2 - y1)), 0.001),
      ...(x2 < x1 ? { flipH: true } : {}), ...(y2 < y1 ? { flipV: true } : {}), line: { ...line, ...(o.head?.line_end && o.head.line_end !== 'none' ? { endArrowType: 'triangle' } : {}), ...(o.tail?.line_end && o.tail.line_end !== 'none' ? { beginArrowType: 'triangle' } : {}) } })
    return
  }
  // audio and anything else has nothing to show on the slide
}

function drawTable(slide: J, t: J, b: Box) {
  const vp = isObj(t.visual_properties) ? t.visual_properties : {}
  const nCols = Math.max(1, Number(t.number_of_columns) || 0), nRows = Math.max(1, Number(t.number_of_rows) || (t.content?.length ?? 1))
  const hdrR = Number(t.number_of_header_rows ?? 0), hdrC = Number(t.number_of_header_columns ?? 0), ftrR = Number(t.number_of_footer_rows ?? 0)
  const heads: J[] = Array.isArray(t.column_headers) ? t.column_headers : []
  const colW = Array.from({ length: nCols }, (_, i) => IN(Number(heads[i]?.column_width ?? t.default_column_width ?? 98)))
  const rowIds: string[] = [], colIds: string[] = heads.map((h) => String(h?.column_identifier ?? ''))
  const rows: J[] = Array.isArray(t.content) ? t.content : []
  const area = (r: number, c: number) => (r < hdrR ? 'header_row' : r >= nRows - ftrR ? 'footer_row' : c < hdrC ? 'header_column' : 'body')
  // lines: Keynote keeps them per area (body / header row / header column / footer), edges and inner lines apart
  const line = (st: J, visible = true) => { const l = visible ? strokeOf(st) : undefined; return l ? { type: 'solid', pt: l.width, color: l.color } : { type: 'none' } }
  const body = vp.body_stroke_properties ?? {}, hr = vp.header_row_stroke_properties ?? {}, hc = vp.header_column_stroke_properties ?? {}, fr = vp.footer_row_stroke_properties ?? {}
  const bVis = body.border_strokes_visible !== false
  const hLine = (r: number) => { // the line above row r
    if (r === 0) return line(hdrR ? hr.border_stroke ?? body.horizontal_border_stroke : body.horizontal_border_stroke, bVis)
    if (r === nRows) return line(ftrR ? fr.border_stroke ?? body.horizontal_border_stroke : body.horizontal_border_stroke, bVis)
    if (hdrR && r === hdrR) return line(hr.separator_stroke, hr.separator_visible !== false)
    if (ftrR && r === nRows - ftrR) return line(fr.separator_stroke, fr.separator_visible !== false)
    if (r < hdrR) return line(hr.horizontal_stroke, hr.across_strokes_visible !== false)
    return line(body.horizontal_stroke, body.horizontal_strokes_visible !== false)
  }
  const vLine = (r: number, c: number) => { // the line left of column c in row r
    if (c === 0 || c === nCols) return line(body.vertical_border_stroke, bVis)
    if (hdrC && c === hdrC) return line(hc.separator_stroke, hc.separator_visible !== false)
    if (r < hdrR) return line(hr.vertical_stroke, hr.across_strokes_visible !== false)
    return line(body.vertical_stroke, body.vertical_strokes_visible !== false)
  }
  const grid: J[][] = []
  const rowH: number[] = []
  // every row's cells by column (sparse rows name the column of the first cell after a gap)
  const at: J[][] = rows.map((row) => { const by: J[] = []; let c = 0; for (const cell of row?.cells ?? []) { if (cell?.column_index != null) c = Number(cell.column_index); if (c < nCols) by[c] = cell; c++ } return by })
  // a cell's own line wins, then the neighbour's line on the shared edge, then the table area's line
  const cellLine = (st: J) => (st === undefined ? undefined : line(st))
  const edge = (r: number, c: number, side: 'top' | 'bottom' | 'left' | 'right', fallback: J) => {
    const own = at[r]?.[c]?.strokes?.[side]
    const nb = side === 'top' ? at[r - 1]?.[c]?.strokes?.bottom : side === 'bottom' ? at[r + 1]?.[c]?.strokes?.top : side === 'left' ? at[r]?.[c - 1]?.strokes?.right : at[r]?.[c + 1]?.strokes?.left
    return cellLine(own) ?? cellLine(nb) ?? fallback
  }
  for (let r = 0; r < nRows; r++) {
    const row = rows[r] ?? {}
    rowIds.push(String(row.row_identifier ?? ''))
    rowH.push(IN(Number(row.row_height ?? t.default_row_height ?? 20)))
    const cells: J[] = []
    const byCol: J[] = at[r] ?? []
    for (let c = 0; c < nCols; c++) {
      const cell = byCol[c] ?? {}, a = area(r, c)
      const tp = merge(merge(merge(vp[a + '_text_properties'] ?? vp.body_text_properties ?? {}, heads[c]?.text_properties ?? {}), row.text_properties ?? {}), cell.text_properties ?? {})
      const cp = merge(merge(merge(vp[a + '_cell_properties'] ?? vp.body_cell_properties ?? {}, heads[c]?.cell_properties ?? {}), row.cell_properties ?? {}), cell.cell_properties ?? {})
      const uv = cell.unformatted_value
      const rich = isObj(uv?.rich_text) ? uv.rich_text : isObj(uv?.text) ? uv.text : null
      const runs = rich ? textRuns(rich, tp).runs : textRuns({ string: String(cell.value ?? (uv?.number ?? uv?.boolean ?? '') ?? '') }, tp).runs
      const fill = fillColor(cp?.fill)
      const pad = isObj(cp?.padding) ? cp.padding : null
      cells.push({ text: runs.length ? runs : '', options: {
        ...(cp?.vertical_alignment ? { valign: cp.vertical_alignment === 'center' ? 'middle' : cp.vertical_alignment } : {}),
        ...(fill ? { fill: { color: fill.color } } : {}),
        ...(pad ? { margin: [Number(pad.top ?? 0), Number(pad.right ?? 0), Number(pad.bottom ?? 0), Number(pad.left ?? 0)] } : {}),
        border: [edge(r, c, 'top', hLine(r)), edge(r, c, 'right', vLine(r, c + 1)), edge(r, c, 'bottom', hLine(r + 1)), edge(r, c, 'left', vLine(r, c))],
      } })
    }
    grid.push(cells)
  }
  // merged ranges: content in the top-left cell, the others removed
  for (const m of t.merges ?? []) {
    const g = m?.row_column_id_range; if (!isObj(g)) continue
    const r0 = rowIds.indexOf(g.top_left_row_identifier), r1 = rowIds.indexOf(g.bottom_right_row_identifier)
    const c0 = colIds.indexOf(g.top_left_column_identifier), c1 = colIds.indexOf(g.bottom_right_column_identifier)
    if (r0 < 0 || r1 < r0 || c0 < 0 || c1 < c0) continue
    grid[r0][c0].options.rowspan = r1 - r0 + 1; grid[r0][c0].options.colspan = c1 - c0 + 1
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r !== r0 || c !== c0) grid[r][c] = null
  }
  const clean = grid.map((row) => row.filter((x) => x !== null))
  slide.addTable(clean, { x: IN(b.x), y: IN(b.y), colW, rowH })
}

function drawChart(ctx: Ctx, pptx: J, slide: J, chart: J, b: Box) {
  const [type] = formKeys(chart)
  const c = chart[type]
  const data = c?.data
  if (!isObj(data) || !Array.isArray(data.rows) || !data.rows.length) { ctx.notes.add('일부 차트는 옮기지 못했습니다.'); return }
  const val = (v: J) => (isObj(v) ? Number(v.number ?? NaN) : typeof v === 'string' ? Number(v) : Number(v))
  const grid: number[][] = data.rows.map((r: J) => (r?.values ?? []).map(val))
  const width = Math.max(...grid.map((r) => r.length))
  const byCols = data.plot_direction === 'columns_as_series'
  const rowL: string[] = data.row_labels ?? [], colL: string[] = data.column_labels ?? []
  const series = byCols
    ? Array.from({ length: width }, (_, j) => ({ name: colL[j] ?? `계열 ${j + 1}`, labels: grid.map((_, i) => rowL[i] ?? String(i + 1)), values: grid.map((r) => (Number.isFinite(r[j]) ? r[j] : 0)) }))
    : grid.map((r, i) => ({ name: rowL[i] ?? `계열 ${i + 1}`, labels: Array.from({ length: width }, (_, j) => colL[j] ?? String(j + 1)), values: Array.from({ length: width }, (_, j) => (Number.isFinite(r[j]) ? r[j] : 0)) }))
  const C = pptx.charts
  const map: Record<string, [J, J]> = {
    column: [C.BAR, { barDir: 'col' }], column_3d: [C.BAR, { barDir: 'col' }], column_interactive: [C.BAR, { barDir: 'col' }],
    stacked_column: [C.BAR, { barDir: 'col', barGrouping: 'stacked' }], stacked_column_3d: [C.BAR, { barDir: 'col', barGrouping: 'stacked' }],
    bar: [C.BAR, { barDir: 'bar' }], bar_3d: [C.BAR, { barDir: 'bar' }], bar_interactive: [C.BAR, { barDir: 'bar' }],
    stacked_bar: [C.BAR, { barDir: 'bar', barGrouping: 'stacked' }], stacked_bar_3d: [C.BAR, { barDir: 'bar', barGrouping: 'stacked' }],
    line: [C.LINE, {}], line_3d: [C.LINE, {}], area: [C.AREA, {}], area_3d: [C.AREA, {}], stacked_area: [C.AREA, { barGrouping: 'stacked' }], stacked_area_3d: [C.AREA, { barGrouping: 'stacked' }],
    pie: [C.PIE, {}], pie_3d: [C.PIE, {}], donut: [C.DOUGHNUT, {}], radar: [C.RADAR, {}], scatter: [C.SCATTER, {}], scatter_interactive: [C.SCATTER, {}],
    mixed: [C.BAR, { barDir: 'col' }], two_axis: [C.BAR, { barDir: 'col' }],
  }
  const [kind, opts] = map[type] ?? [C.BAR, { barDir: 'col' }]
  if (!map[type]) ctx.notes.add('일부 차트는 막대 차트로 옮겨졌습니다.')
  // Keynote's look: title, series colours, value labels in their number format, axis labels shown or not, legend place
  const ks: J[] = Array.isArray(c.series) ? [...c.series].sort((x, y) => Number(x?.series_index ?? 0) - Number(y?.series_index ?? 0)) : []
  const colors = series.map((_, i) => fillColor(ks[i]?.fill)?.color ?? fillColor(c.chart_colors?.[i]?.fill)?.color).filter(Boolean) as string[]
  const titleText = c.title?.is_visible !== false && c.title?.text ? textRuns(c.title.text, {}).plain.trim() : ''
  const titleSize = Number(c.title?.paragraph_properties?.character_properties?.font_size ?? 0) || undefined
  const showValues = ks.some((x) => x?.show_value_labels)
  const pct = ks.some((x) => /percent/i.test(String(x?.label_format_type ?? '')))
  const dp = Number(ks[0]?.label_number_format?.decimal_places ?? 0)
  const fmt = pct ? (dp > 0 && dp < 20 ? '0.' + '0'.repeat(dp) + '%' : '0%') : dp > 0 && dp < 20 ? '0.' + '0'.repeat(dp) : 'General'
  const lg = box(c.legend?.geometry)
  const look: J = {
    ...(colors.length === series.length ? { chartColors: colors } : {}),
    ...(titleText ? { showTitle: true, title: titleText, ...(titleSize ? { titleFontSize: titleSize } : {}) } : {}),
    ...(showValues ? { showValue: true, dataLabelFormatCode: fmt, dataLabelPosition: 'outEnd' } : {}),
    ...(c.value_axis?.show_labels === false ? { valAxisHidden: true } : {}),
    ...(c.value_axis?.show_major_gridlines === false ? { valGridLine: { style: 'none' } } : {}),
    ...(lg ? (() => { // the legend's frame is measured within the chart (a slide position below the chart's top is used as one)
      const rel = lg.y < b.y || lg.x < b.x ? { x: lg.x + lg.w / 2, y: lg.y + lg.h / 2 } : { x: lg.x - b.x + lg.w / 2, y: lg.y - b.y + lg.h / 2 }
      return { legendPos: rel.y > b.h * 0.6 ? 'b' : rel.y < b.h * 0.25 ? 't' : rel.x > b.w * 0.6 ? 'r' : 'l' }
    })() : {}),
  }
  try { slide.addChart(kind, kind === C.PIE || kind === C.DOUGHNUT ? series.slice(0, 1) : series, { ...frame(b), ...opts, ...look, showLegend: c.show_legend !== false && (series.length > 1 || kind === C.PIE || kind === C.DOUGHNUT) }) }
  catch { ctx.notes.add('일부 차트는 옮기지 못했습니다.') }
}

// ---------------------------------------------------------------- slides
function placeholderKind(so: J): string | null {
  const pi = so?.placeholder_info
  if (!isObj(pi)) return null
  if (isObj(pi.defined)) return String(pi.defined.kind ?? '')
  if (pi.tagged != null) return 'tag:' + JSON.stringify(pi.tagged)
  return null
}
const placeholderHidden = (so: J) => isObj(so?.placeholder_info?.defined) && so.placeholder_info.defined.is_visible === false
const objectId = (obj: J) => { const [k] = isObj(obj) ? formKeys(obj) : []; return k && isObj(obj[k]) ? obj[k].identifier : undefined }

async function background(ctx: Ctx, slide: J, bg: J) {
  const f = isObj(bg) ? bg.standard : null
  if (!isObj(f)) return
  if (isObj(f.image)) { const url = await ctx.image(f.image.resource); if (url) { slide.background = { data: url }; return } }
  const c = fillColor(f)
  if (c) slide.background = { color: c.color, ...(c.transparency ? { transparency: c.transparency } : {}) }
}

export function isKeyx(zip: JSZip): string | null {
  const main = Object.keys(zip.files).filter((n) => /(^|\/)main\.json$/.test(n) && !zip.files[n].dir).sort((a, b) => a.length - b.length)[0]
  return main ? main.slice(0, main.length - 'main.json'.length) : null
}

export async function keyxToPptx(buf: ArrayBuffer): Promise<{ bytes: Uint8Array; notes: string[] }> {
  const zip = await JSZip.loadAsync(buf)
  const base = isKeyx(zip)
  if (base == null) throw new Error('Keynote 교환 형식(.keyx) 파일이 아닙니다.')
  const ctx = new Ctx(zip, base)
  const pres = zip.file(base + 'presets.json')
  if (pres) {
    try {
      const j = JSON.parse(await pres.async('string'))
      const list: J[] = Array.isArray(j) ? j : Array.isArray(j?.presets) ? j.presets : (Object.values(j ?? {}).find(Array.isArray) as J[]) ?? []
      for (const p of list) if (isObj(p) && typeof p.identifier === 'string') ctx.presets.set(p.identifier, p)
    } catch { ctx.notes.add('공유 서식(presets.json)을 읽지 못했습니다.') }
  }
  const doc = ctx.resolve(JSON.parse(await zip.file(base + 'main.json')!.async('string')))
  const P: any = (PptxGenJS as any).default ?? PptxGenJS
  const pptx = new P()
  const size = isObj(doc.slide_size) ? doc.slide_size : { width: 1920, height: 1080 }
  pptx.defineLayout({ name: 'KEYX', width: IN(Number(size.width) || 1920), height: IN(Number(size.height) || 1080) })
  pptx.layout = 'KEYX'
  const layouts: J[] = Array.isArray(doc.theme?.slide_layouts) ? doc.theme.slide_layouts : []
  if (!layouts.length) ctx.notes.add('테마의 배경·장식은 파일에 들어 있지 않아 옮겨지지 않았을 수 있습니다.')
  for (const s of doc.slides ?? []) {
    const slide = pptx.addSlide()
    const layout = layouts.find((l) => l?.identifier && l.identifier === s.layout) ?? layouts.find((l) => l?.name && l.name === s.layout) ?? layouts[0]
    await background(ctx, slide, s.background ?? layout?.background)
    const lContents: J[] = Array.isArray(layout?.contents) ? layout.contents : []
    const layered = !!layout?.slide_objects_layer_with_layout
    // layout decorations (not placeholders) behind the slide's own objects, unless the slide lists them itself
    if (!layered) for (const lo of lContents) if (!placeholderKind(lo) && lo?.source_kind !== 'placeholder') await draw(ctx, pptx, slide, lo.object)
    for (const so of s.contents ?? []) {
      if (!isObj(so) || placeholderHidden(so)) continue
      let obj = so.object
      const pk = placeholderKind(so)
      if (pk) { // a placeholder takes what it leaves out (frame, styles) from the layout's placeholder of the same kind
        if (pk === 'slide_number') continue
        const lp = lContents.find((l) => placeholderKind(l) === pk)
        if (lp) obj = merge(lp.object, obj)
      } else if (so.source_kind === 'layout') {
        const id = objectId(obj); const lo = id ? lContents.find((l) => objectId(l?.object) === id) : null
        if (lo) obj = merge(lo.object, obj)
      }
      await draw(ctx, pptx, slide, obj)
    }
    const note = s.note ? textRuns(s.note, {}).plain : ''
    if (note.trim()) slide.addNotes(note)
  }
  const bytes = (await pptx.write({ outputType: 'uint8array' })) as Uint8Array
  return { bytes, notes: [...ctx.notes] }
}

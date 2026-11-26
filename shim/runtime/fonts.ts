// AllEditor bundled fonts (fonts/ in the repository, shipped at office/hwp/studio/fonts — the folder the 한글
// editor reads its own font files from, so every editor shares one copy). Free fonts only (SIL OFL 1.1):
// 나눔고딕 · 나눔명조 · 나눔고딕코딩 · Noto Sans KR · Noto Serif KR · Pretendard · 고운바탕 · 고운돋움.
//
// Registered as @font-face rules in every office page: a file is fetched only when text actually uses its family,
// so unused fonts cost no memory. Both the English and the Korean family names are registered (documents written on
// Windows / 한글 store either). A local() source comes first, so a font the iPad already has is used as is.
//
// Canvas editors (PowerPoint, Excel) draw with canvas text, which does not make the browser fetch a web font. The
// hook below notices a bundled family being set on a canvas, loads it, and asks the page to redraw once it is ready.

export const FONT_BASE = '/hwp/studio/fonts/'

type Face = { file: string; weight: number }
const FAMILIES: Array<{ names: string[]; local: string[]; faces: Face[] }> = [
  { names: ['Nanum Gothic', '나눔고딕', 'NanumGothic'], local: ['NanumGothic'],
    faces: [{ file: 'NanumGothic-Regular.woff2', weight: 400 }, { file: 'NanumGothic-Bold.woff2', weight: 700 }] },
  { names: ['Nanum Myeongjo', '나눔명조', 'NanumMyeongjo'], local: ['NanumMyeongjo'],
    faces: [{ file: 'NanumMyeongjo-Regular.woff2', weight: 400 }, { file: 'NanumMyeongjo-Bold.woff2', weight: 700 }] },
  { names: ['Nanum Gothic Coding', '나눔고딕코딩', 'NanumGothicCoding'], local: ['NanumGothicCoding'],
    faces: [{ file: 'NanumGothicCoding-Regular.woff2', weight: 400 }] },
  { names: ['Noto Sans KR', '본고딕'], local: ['Noto Sans KR', 'NotoSansKR-Regular'],
    faces: [{ file: 'NotoSansKR-ExtraLight.woff2', weight: 200 }, { file: 'NotoSansKR-Regular.woff2', weight: 400 }, { file: 'NotoSansKR-Bold.woff2', weight: 700 }] },
  { names: ['Noto Serif KR', '본명조'], local: ['Noto Serif KR', 'NotoSerifKR-Regular'],
    faces: [{ file: 'NotoSerifKR-Regular.woff2', weight: 400 }, { file: 'NotoSerifKR-Bold.woff2', weight: 700 }] },
  { names: ['Pretendard', '프리텐다드'], local: ['Pretendard'],
    faces: [['Thin', 100], ['ExtraLight', 200], ['Light', 300], ['Regular', 400], ['Medium', 500], ['SemiBold', 600], ['Bold', 700], ['ExtraBold', 800], ['Black', 900]]
      .map(([n, w]) => ({ file: `Pretendard-${n}.woff2`, weight: w as number })) },
  { names: ['Gowun Batang', '고운바탕'], local: ['Gowun Batang'],
    faces: [{ file: 'GowunBatang-Regular.woff2', weight: 400 }, { file: 'GowunBatang-Bold.woff2', weight: 700 }] },
  { names: ['Gowun Dodum', '고운돋움'], local: ['Gowun Dodum'],
    faces: [{ file: 'GowunDodum-Regular.woff2', weight: 400 }] },
]

// Windows / 한컴 fonts the iPad does not have, shown with a free look-alike from the bundle. A document keeps the
// font name it stores (on Windows it shows in the real font); a local() source comes first, so the real font
// wins wherever it is installed. The Word editor has its own metric-matched stand-ins and keeps them.
const SANS_KR: Face[] = [{ file: 'Pretendard-Regular.woff2', weight: 400 }, { file: 'Pretendard-Bold.woff2', weight: 700 }]
const GOTHIC_KR: Face[] = [{ file: 'NanumGothic-Regular.woff2', weight: 400 }, { file: 'NanumGothic-Bold.woff2', weight: 700 }]
const SERIF_KR: Face[] = [{ file: 'NanumMyeongjo-Regular.woff2', weight: 400 }, { file: 'NanumMyeongjo-Bold.woff2', weight: 700 }]
export const ALIASES: Array<{ names: string[]; shownAs: string; faces: Face[] }> = [
  { names: ['Malgun Gothic', '맑은 고딕'], shownAs: 'Pretendard', faces: SANS_KR },
  { names: ['Gulim', '굴림', 'GulimChe', '굴림체', 'New Gulim', '새굴림', 'Dotum', '돋움', 'DotumChe', '돋움체', '함초롬돋움', 'HCR Dotum', '한컴돋움'], shownAs: '나눔고딕', faces: GOTHIC_KR },
  { names: ['Batang', '바탕', 'BatangChe', '바탕체', 'Gungsuh', '궁서', 'GungsuhChe', '궁서체', '함초롬바탕', 'HCR Batang', '한컴바탕'], shownAs: '나눔명조', faces: SERIF_KR },
  { names: ['Calibri', 'Calibri Light'], shownAs: 'Carlito', faces: [{ file: 'Carlito-Regular.woff2', weight: 400 }, { file: 'Carlito-Bold.woff2', weight: 700 }] },
  { names: ['Cambria'], shownAs: 'Caladea', faces: [{ file: 'Caladea-Regular.woff2', weight: 400 }, { file: 'Caladea-Bold.woff2', weight: 700 }] },
  { names: ['Segoe UI', 'Tahoma', 'Aptos'], shownAs: 'Liberation Sans', faces: [{ file: 'LiberationSans-Regular.woff2', weight: 400 }, { file: 'LiberationSans-Bold.woff2', weight: 700 }] },
]
/** fonts of the pickers that neither the iPad nor the bundle has (they show in a fallback font) */
export const MISSING = new Set(['Impact', 'Garamond', '等线', '等线 Light', '宋体', '黑体', '微软雅黑', '楷体', '仿宋', '仿宋_GB2312', '楷体_GB2312', '方正小标宋简体',
  'Noto Sans SC', 'Noto Serif SC', 'Yu Gothic', 'Yu Mincho', 'Meiryo', 'MS Gothic', 'MS Mincho', 'Noto Sans JP', 'Noto Serif JP',
  'Microsoft JhengHei', 'PMingLiU', 'Noto Sans TC', 'Noto Serif TC'])

/** every family name the bundle answers to (lower-case) */
export const BUNDLED_FAMILY_NAMES = new Set([...FAMILIES, ...ALIASES].flatMap((f) => f.names.map((n) => n.toLowerCase())))

export function bundledFontCss(base = FONT_BASE, aliases = true): string {
  const rules: string[] = []
  if (aliases) for (const a of ALIASES) for (const name of a.names) for (const face of a.faces) {
    rules.push(`@font-face{font-family:"${name}";src:local("${name}"),url("${base}${face.file}") format("woff2");font-weight:${face.weight};font-style:normal;font-display:swap}`)
  }
  for (const fam of FAMILIES) {
    for (const name of fam.names) {
      for (const face of fam.faces) {
        const local = face.weight === 400 ? fam.local.map((l) => `local("${l}")`).join(', ') + ', ' : ''
        rules.push(`@font-face{font-family:"${name}";src:${local}url("${base}${face.file}") format("woff2");font-weight:${face.weight};font-style:normal;font-display:swap}`)
      }
    }
  }
  return rules.join('\n')
}

/** the font families named in a canvas `font` shorthand ("bold 12px 'Nanum Gothic', sans-serif") */
function familiesOf(font: string): string[] {
  const m = /(?:^|\s)\d+(?:\.\d+)?(?:px|pt|em|rem|%)(?:\/\S+)?\s+(.+)$/.exec(font)
  if (!m) return []
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

function installCanvasHook() {
  const proto = (globalThis as any).CanvasRenderingContext2D?.prototype
  const desc = proto && Object.getOwnPropertyDescriptor(proto, 'font')
  if (!desc?.set || !desc.get || !(document as any).fonts) return
  const seen = new Set<string>()
  let redraw = 0
  Object.defineProperty(proto, 'font', {
    configurable: true,
    enumerable: desc.enumerable,
    get: desc.get,
    set(this: CanvasRenderingContext2D, v: string) {
      desc.set!.call(this, v)
      if (typeof v !== 'string' || seen.has(v)) return
      seen.add(v)
      if (!familiesOf(v).some((f) => BUNDLED_FAMILY_NAMES.has(f.toLowerCase()))) return
      if (document.fonts.check(v)) return
      void document.fonts.load(v).then((faces) => {
        if (!faces.length) return
        // one redraw for a burst of loads: editors repaint on resize, and Konva/Univer also listen to loadingdone
        clearTimeout(redraw)
        redraw = window.setTimeout(() => {
          try { document.fonts.dispatchEvent(new Event('loadingdone')) } catch {}
          window.dispatchEvent(new Event('resize'))
        }, 60)
      }, () => {})
    },
  })
}

// The font pickers mark what the iPad shows for a name: "≈ 나눔고딕" for a stand-in, "iPad에 없음" for a font
// shown in a fallback font. (The lists also put the missing ones last: scripts/build-web.mjs, font-list.ts.)
const NOTE_CSS = `.ae-font-note{margin-left:6px;font:11px -apple-system,system-ui,sans-serif;color:#8e8e93;font-style:normal;font-weight:400;white-space:nowrap}`
function noteFor(name: string, app: string): string | null {
  const ko = (() => { try { return (JSON.parse(localStorage.getItem('alleditor.settings') || '{}').language ?? 'ko') !== 'en' } catch { return true } })()
  const alias = ALIASES.find((a) => a.names.includes(name))
  if (alias) return app === 'docs' ? (ko ? '대체 글꼴로 표시' : 'shown in a stand-in') : `≈ ${alias.shownAs}`
  if (MISSING.has(name)) return ko ? 'iPad에 없음' : 'not on iPad'
  return null
}
function markFontLists(app: string) {
  if (!document.body) { document.addEventListener('DOMContentLoaded', () => markFontLists(app)); return }
  const style = document.createElement('style'); style.textContent = NOTE_CSS; document.head.appendChild(style)
  const mark = (root: ParentNode) => {
    for (const el of root.querySelectorAll<HTMLElement>('button, [role="option"], [role="menuitem"], li')) {
      if (el.dataset.aeFontNote) continue
      const first = el.firstChild
      if (!first || first.nodeType !== Node.TEXT_NODE) continue
      const note = noteFor((first.textContent ?? '').trim(), app)
      if (!note) continue
      // only font pickers: the item previews its font, or sits in a font menu
      if (!el.style.fontFamily && !el.closest('[class*="font" i], [data-font-key]') && !el.dataset.fontKey) continue
      el.dataset.aeFontNote = '1'
      const span = document.createElement('span'); span.className = 'ae-font-note'; span.textContent = note
      first.after(span)
    }
  }
  let raf = 0
  new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => mark(document.body)) })
    .observe(document.body, { childList: true, subtree: true })
}

export function installBundledFonts(app = '') {
  const add = () => {
    if (document.getElementById('ae-bundled-fonts')) return
    const style = document.createElement('style')
    style.id = 'ae-bundled-fonts'
    style.textContent = bundledFontCss(FONT_BASE, app !== 'docs')
    document.head.appendChild(style)
    markFontLists(app)
  }
  if (document.head) add(); else document.addEventListener('DOMContentLoaded', add)
  installCanvasHook()
}

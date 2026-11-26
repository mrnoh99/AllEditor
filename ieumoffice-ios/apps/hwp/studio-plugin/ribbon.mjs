// [AllEditor] Word-style ribbon for the 한글 editor (rhwp-studio). The document stays HWP/HWPX: only the menus change.
//
// The studio's menu bar (파일 · 편집 · 보기 · 입력 · 서식 · 쪽 · 표 · 도구, each a drop-down) becomes the same
// layout as the Word editor of the suite:
//   [파일] [저장 · 되돌리기 · 다시 실행 · 인쇄]  홈 · 삽입 · 서식 · 레이아웃 · 표 · 검토 · 보기
//   one ribbon row below the tabs
// 홈 shows the studio's own tool box and formatting bar (clipboard, 글자/문단 모양, 글꼴, 크기, 정렬, …). Every
// other tab is built from the studio's own menu items, so each button runs exactly the command the menu ran
// (same `data-cmd`, same parameters, dispatched by the menu bar's own click handler). 파일 keeps its menu.

const TABS = [
  { id: 'home', ko: '홈', en: 'Home' },
  { id: 'insert', ko: '삽입', en: 'Insert', menus: ['insert'] },
  { id: 'format', ko: '서식', en: 'Format', menus: ['format'] },
  { id: 'page', ko: '레이아웃', en: 'Layout', menus: ['page'] },
  { id: 'table', ko: '표', en: 'Table', menus: ['table'] },
  { id: 'review', ko: '검토', en: 'Review', menus: ['edit', 'tool'] },
  { id: 'view', ko: '보기', en: 'View', menus: ['view'] },
]
const QUICK = [
  { cmd: 'file:save', ko: '저장', en: 'Save', svg: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>' },
  { cmd: 'edit:undo', ko: '되돌리기', en: 'Undo', svg: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>' },
  { cmd: 'edit:redo', ko: '다시 실행', en: 'Redo', svg: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>' },
  { cmd: 'file:print', ko: '인쇄', en: 'Print', svg: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>' },
]

// icons for the menu items that have none in the studio's sprite (Lucide-style strokes, 24×24)
const T = (txt, extra = '') => `<text x="12" y="17" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor" stroke="none" ${extra}>${txt}</text>`
const L = (...ys) => ys.map(([x1, x2, y]) => `<path d="M${x1} ${y}h${x2 - x1}"/>`).join('')
const ICONS = {
  'format:bold': T('B'), 'format:italic': T('I', 'font-style="italic" font-family="Georgia,serif"'), 'format:underline': T('U') + '<path d="M6 21h12"/>',
  'format:align-left': L([3, 21, 6], [3, 15, 10], [3, 21, 14], [3, 13, 18]), 'format:align-center': L([3, 21, 6], [6, 18, 10], [3, 21, 14], [7, 17, 18]),
  'format:align-right': L([3, 21, 6], [9, 21, 10], [3, 21, 14], [11, 21, 18]), 'format:align-justify': L([3, 21, 6], [3, 21, 10], [3, 21, 14], [3, 21, 18]),
  'format:align-distribute': L([3, 21, 6], [3, 21, 10], [3, 21, 14]) + '<path d="M3 18h2m4 0h2m4 0h2m2 0h1"/>',
  'format:font-size-increase': T('A', 'font-size="14" x="9"') + '<path d="M17 10V4m-3 3 3-3 3 3"/>', 'format:font-size-decrease': T('A', 'font-size="14" x="9"') + '<path d="M17 4v6m-3-3 3 3 3-3"/>',
  'format:line-spacing-increase': L([10, 21, 6], [10, 21, 12], [10, 21, 18]) + '<path d="M3 8l3-3 3 3M6 5v14M3 16l3 3 3-3"/>', 'format:line-spacing-decrease': L([10, 21, 6], [10, 21, 12], [10, 21, 18]) + '<path d="M3 5l3 3 3-3M6 8v8M3 19l3-3 3 3"/>',
  'format:level-increase': L([3, 21, 5], [11, 21, 10], [11, 21, 14], [3, 21, 19]) + '<path d="m3 9 3 3-3 3"/>', 'format:level-decrease': L([3, 21, 5], [11, 21, 10], [11, 21, 14], [3, 21, 19]) + '<path d="m7 9-3 3 3 3"/>',
  'format:para-num-shape': '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>', 'format:bullet-shape': '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  'format:style-dialog': T('Aa', 'font-size="12"') + '<rect x="2" y="3" width="20" height="18" rx="2"/>',
  'page:page-border': '<rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7" y="7" width="10" height="10" stroke-dasharray="2 2"/>',
  'page:header-create': '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/>', 'page:footer-create': '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 18h8"/>',
  'page:new-page-num': '<rect x="4" y="2" width="16" height="20" rx="2"/>' + T('1', 'font-size="11" y="16"'), 'page:hide-current': '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="m3 3 18 18"/>',
  'page:break': '<path d="M5 3v5h14V3M5 21v-5h14v5"/><path d="M3 12h2m3 0h2m3 0h2m3 0h2"/>', 'page:column-break': '<path d="M4 4v16M20 4v16M12 3v3m0 3v3m0 3v3m0 3v1"/>',
  'page:col-1': '<rect x="5" y="3" width="14" height="18" rx="1"/>', 'page:col-2': '<rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/>',
  'page:col-3': '<rect x="2" y="3" width="5.5" height="18" rx="1"/><rect x="9.25" y="3" width="5.5" height="18" rx="1"/><rect x="16.5" y="3" width="5.5" height="18" rx="1"/>',
  'page:col-left': '<rect x="3" y="3" width="6" height="18" rx="1"/><rect x="11" y="3" width="10" height="18" rx="1"/>', 'page:col-right': '<rect x="3" y="3" width="10" height="18" rx="1"/><rect x="15" y="3" width="6" height="18" rx="1"/>',
  'page:col-settings': '<rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/><path d="M15 9h4M15 12h4"/>', 'page:section-settings': '<path d="M4 4h16M4 9h16M4 15h16M4 20h16"/><path d="M2 12h20" stroke-dasharray="2 2"/>',
  'insert:equation': T('∑', 'font-size="17"'), 'insert:field': '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h2m3 0h5"/>', 'insert:bookmark': '<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  'insert:para-band': '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M3 4h18M3 20h18"/>', 'insert:rotate-cw': '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 'insert:rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  'insert:flip-horz': '<path d="M12 3v18"/><path d="m8 7-5 5 5 5V7ZM16 7l5 5-5 5V7Z"/>', 'insert:flip-vert': '<path d="M3 12h18"/><path d="m7 8 5-5 5 5H7ZM7 16l5 5 5-5H7Z"/>',
  'table:cell-props': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>', 'table:cell-split': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18" stroke-dasharray="3 2"/>',
  'table:cell-merge': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 9-3 3 3 3M16 9l3 3-3 3M5 12h14"/>', 'table:insert-row-col': '<rect x="3" y="3" width="13" height="13" rx="1"/><path d="M3 9.5h13M9.5 3v13M19 16v6M16 19h6"/>',
  'table:delete-row-col': '<rect x="3" y="3" width="13" height="13" rx="1"/><path d="M3 9.5h13M9.5 3v13M16 19h6"/>', 'table:cell-height-equal': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/>',
  'table:cell-width-equal': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>', 'table:border-each': '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 3v18M3 12h18"/>',
  'table:border-one': '<rect x="3" y="3" width="18" height="18" rx="1"/>', 'table:transpose-copy': '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V4h12"/>', 'table:transpose-paste': '<path d="M9 2h6v4H9z"/><path d="M15 4h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3"/>',
  'table:block-formula': T('fx', 'font-size="13" font-style="italic"'), 'table:block-sum': T('∑', 'font-size="17"'), 'table:block-avg': T('x̄', 'font-size="15"'), 'table:block-product': T('∏', 'font-size="16"'),
  'table:thousand-sep': T('1,0', 'font-size="12"'), 'table:decimal-add': T('.0', 'font-size="13"') + '<path d="M18 4v6M15 7h6"/>', 'table:decimal-remove': T('.0', 'font-size="13"') + '<path d="M15 7h6"/>',
  'edit:compare-documents': '<rect x="2" y="4" width="8" height="16" rx="1"/><rect x="14" y="4" width="8" height="16" rx="1"/><path d="M10 12h4"/>', 'edit:document-history': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  'edit:find-again': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>', 'edit:goto': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'tool:options': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  'view:zoom-dialog': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6M11 8v6"/>', 'view:zoom-fit-page': '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 8h6M9 12h6"/>',
  'view:zoom-fit-width': '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>', 'view:border-transparent': '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/>', 'view:toggle-clip': '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
}
// zoom percentages and caption positions are one button with a pop-up, as in Word
const BUNDLES = [
  { match: /^view:zoom-\d+$/, ko: '배율', en: 'Zoom', icon: ICONS['view:zoom-dialog'] },
  { match: /^insert:caption-/, ko: '캡션', en: 'Caption', icon: '<rect x="3" y="3" width="18" height="12" rx="1"/><path d="M6 19h12"/>' },
]
const KEY = 'alleditor.hwpRibbonTab'
const ko = () => !/^en/i.test(document.documentElement.lang || navigator.language || 'ko')
const icon = (paths, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

const CSS = `
#menu-bar.ae-ribbon{display:flex;flex-wrap:wrap;align-items:center;gap:2px 4px;padding:6px 10px 0;height:auto;min-height:0;
  background:var(--ae-rb-bg,#fff);border-bottom:1px solid var(--ae-rb-line,#e3e3e3);font-family:inherit}
#menu-bar.ae-ribbon > .menu-item:not([data-menu="file"]),#menu-bar.ae-ribbon > #toolbox-basic-toggle{display:none!important}
#menu-bar.ae-ribbon > .menu-item[data-menu="file"] > .menu-title{background:#1b5fc1;color:#fff;border-radius:5px;padding:5px 14px;font-weight:600;font-size:14px;line-height:1.3}
#menu-bar.ae-ribbon .ae-qa{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:0;background:none;border-radius:6px;color:var(--ae-rb-fg,#444);cursor:pointer;padding:0}
#menu-bar.ae-ribbon .ae-qa:hover,#menu-bar.ae-ribbon .ae-tab:hover{background:var(--ae-rb-hover,#f0f0f0)}
#menu-bar.ae-ribbon .ae-qa.disabled{opacity:.35}
#menu-bar.ae-ribbon .ae-vsep{width:1px;height:20px;background:var(--ae-rb-line,#ddd);margin:0 6px}
#menu-bar.ae-ribbon .ae-tab{border:0;background:none;padding:6px 10px 7px;font-size:14px;font-weight:600;color:var(--ae-rb-fg,#333);cursor:pointer;position:relative;border-radius:6px 6px 0 0}
#menu-bar.ae-ribbon .ae-tab.on{color:#1b5fc1}
#menu-bar.ae-ribbon .ae-tab.on::after{content:"";position:absolute;left:50%;bottom:0;width:18px;height:3px;margin-left:-9px;border-radius:2px;background:#1b5fc1}
#ae-ribbon{flex:1 0 100%;display:flex;align-items:stretch;gap:0;overflow-x:auto;scrollbar-width:none;margin:4px -10px 0;padding:6px 8px;
  border-top:1px solid var(--ae-rb-line,#eee);background:var(--ae-rb-bg,#fff);min-height:64px}
#ae-ribbon::-webkit-scrollbar{display:none}
#ae-ribbon[hidden]{display:none}
#ae-ribbon .ae-grp{display:flex;align-items:stretch;gap:2px;padding:0 8px;border-right:1px solid var(--ae-rb-line,#e6e6e6);flex:none}
#ae-ribbon .ae-grp:last-child{border-right:0}
#ae-ribbon .md-item.ae-rb,#ae-ribbon .ae-sub-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  min-width:52px;max-width:84px;padding:4px 6px;border-radius:6px;cursor:pointer;background:none;border:0;color:var(--ae-rb-fg,#333);font-size:11.5px;line-height:1.2;text-align:center;white-space:normal;height:auto}
#ae-ribbon .md-item.ae-rb:hover,#ae-ribbon .ae-sub-btn:hover{background:var(--ae-rb-hover,#f0f0f0)}
#ae-ribbon .md-item.ae-rb.disabled{opacity:.38;pointer-events:none}
#ae-ribbon .ae-ico{display:flex;align-items:center;justify-content:center;width:22px;height:22px;color:var(--ae-rb-fg,#333)}
#ae-ribbon .ae-ico .tb-sprite{position:static;margin:0}
#ae-ribbon .md-item.ae-rb .md-shortcut,#ae-ribbon .md-item.ae-rb .md-check{display:none}
#ae-ribbon .md-item.ae-rb .md-label{padding:0;margin:0;position:static;line-height:1.2;white-space:normal}
.ae-sub-pop{position:fixed;z-index:10000;background:var(--ae-rb-bg,#fff);border:1px solid var(--ae-rb-line,#ddd);border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.18);padding:6px;max-height:70vh;overflow:auto;min-width:180px}
.ae-sub-pop .md-item{display:flex;align-items:center;gap:8px;padding:9px 14px 9px 32px;border-radius:6px;cursor:pointer;font-size:14px;white-space:nowrap}
.ae-sub-pop .md-item:hover{background:var(--ae-rb-hover,#f0f0f0)}.ae-sub-pop .md-item.disabled{opacity:.4;pointer-events:none}
.ae-sub-pop .md-shortcut{display:none}
/* the studio's effective theme (follows the app's 테마 setting, see installAllEditorTheme) */
:root[data-theme-effective="dark"]{--ae-rb-bg:#1f1f21;--ae-rb-fg:#e8e8e8;--ae-rb-line:#3a3a3c;--ae-rb-hover:#2c2c2e}
body.ae-ribbon-tab:not(.ae-ribbon-home) #icon-toolbar,body.ae-ribbon-tab:not(.ae-ribbon-home) #style-bar{display:none!important}
`

/** a ribbon button for one menu item: the item itself, cloned (keeps data-cmd and its parameters) */
function itemButton(item) {
  const b = item.cloneNode(true)
  b.classList.add('ae-rb')
  b.classList.remove('disabled')
  b.removeAttribute('id')
  const label = b.querySelector('.md-label')?.textContent?.trim().replace(/\s*\([A-Z]\)/, '').replace(/\.\.\.$|…$/, '') ?? ''
  const ic = b.querySelector('.md-icon')
  const sprite = ic && [...ic.classList].find((c) => c.startsWith('icon-'))
  const holder = document.createElement('span')
  holder.className = 'ae-ico'
  if (sprite && !ICONS[b.dataset.cmd]) {
    const sp = document.createElement('span')
    sp.className = `tb-sprite ${sprite}`
    holder.append(sp)
  } else holder.innerHTML = icon(ICONS[b.dataset.cmd] ?? '<circle cx="12" cy="12" r="2.5"/>', 20)
  ic?.remove()
  b.insertBefore(holder, b.firstChild)
  const lab = b.querySelector('.md-label')
  if (lab) lab.textContent = label
  if (label) b.title = label
  return b
}

function subButton(title, glyph, items, openSub) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'ae-sub-btn'
  btn.innerHTML = `<span class="ae-ico">${icon(glyph, 20)}</span>`
  const lab = document.createElement('span')
  lab.textContent = title + ' ▾'
  btn.append(lab)
  btn.onclick = (e) => { e.stopPropagation(); openSub(btn, items) }
  return btn
}

/** groups of a drop-down: its items split at the separators; a sub-menu becomes one button with a pop-up */
function groupsOf(dropdown, openSub) {
  const groups = [[]]
  const bundled = new Map()
  for (const child of dropdown.children) {
    if (child.classList.contains('md-sep')) { if (groups[groups.length - 1].length) groups.push([]); continue }
    if (child.classList.contains('md-item') && child.dataset.cmd) {
      const bundle = BUNDLES.find((x) => x.match.test(child.dataset.cmd))
      if (bundle) {
        if (!bundled.has(bundle)) { bundled.set(bundle, []); groups[groups.length - 1].push(subButton(ko() ? bundle.ko : bundle.en, bundle.icon, bundled.get(bundle), openSub)) }
        bundled.get(bundle).push(child)
        continue
      }
      groups[groups.length - 1].push(itemButton(child))
    } else if (child.classList.contains('md-sub') && !child.hasAttribute('data-recent')) {
      const items = [...child.querySelectorAll('.md-item[data-cmd]')]
      if (!items.length) continue
      const title = child.querySelector(':scope > .md-label')?.textContent?.trim() || items[0].textContent.trim()
      const bundle = BUNDLES.find((x) => items.some((it) => x.match.test(it.dataset.cmd)))
      groups[groups.length - 1].push(subButton(title, bundle?.icon ?? '<path d="M4 6h16M4 12h16M4 18h10"/>', items, openSub))
    }
  }
  return groups.filter((g) => g.length)
}

/**
 * @param {HTMLElement} bar  the studio's #menu-bar (its click handler dispatches every [data-cmd] inside it)
 * @param {(el: HTMLElement) => void} updateStates  the menu bar's own enabled/disabled refresh for a set of items
 */
export function installAllEditorRibbon(bar, updateStates) {
  if (!bar || bar.classList.contains('ae-ribbon')) return
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  bar.classList.add('ae-ribbon')
  document.body.classList.add('ae-ribbon-tab')

  // quick access (same place as in the Word editor)
  const file = bar.querySelector('.menu-item[data-menu="file"]')
  const anchor = file?.nextSibling ?? null
  for (const q of QUICK) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'menu-command ae-qa md-item'
    b.dataset.cmd = q.cmd
    b.innerHTML = icon(q.svg)
    b.title = ko() ? q.ko : q.en
    b.setAttribute('aria-label', b.title)
    bar.insertBefore(b, anchor)
  }
  const sep = document.createElement('span')
  sep.className = 'ae-vsep'
  bar.insertBefore(sep, anchor)

  const panel = document.createElement('div')
  panel.id = 'ae-ribbon'
  panel.setAttribute('role', 'toolbar')
  let pop = null
  const closePop = () => { pop?.remove(); pop = null }
  const openSub = (btn, items) => {
    closePop()
    pop = document.createElement('div')
    pop.className = 'ae-sub-pop'
    for (const it of items) { const c = it.cloneNode(true); c.classList.remove('disabled'); pop.append(c) }
    bar.append(pop) // inside the menu bar: its click handler runs the command
    updateStates(pop)
    const r = btn.getBoundingClientRect()
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`
    pop.style.top = `${r.bottom + 4}px`
  }
  document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target)) closePop() }, true)
  bar.addEventListener('click', (e) => { if (e.target.closest?.('.ae-sub-pop .md-item')) setTimeout(closePop, 0) })

  const tabs = []
  let current = 'home'
  // the app's own file menu (이음오피스: ext:ieum-save, ext:ieum-print, …) replaces the studio's file commands:
  // a quick button runs whatever the 파일 menu runs for the same job
  const QUICK_ALIASES = { 'file:save': /(?:^|[:-])save$/, 'file:print': /(?:^|[:-])print$/ }
  const resolveQuick = () => {
    const fileCmds = [...bar.querySelectorAll('.menu-item[data-menu="file"] .md-item[data-cmd]')].map((e) => e.dataset.cmd)
    for (const q of bar.querySelectorAll('.ae-qa')) {
      const base = q.dataset.base || (q.dataset.base = q.dataset.cmd)
      const re = QUICK_ALIASES[base]
      if (!re || fileCmds.includes(base)) { q.dataset.cmd = base; continue }
      q.dataset.cmd = fileCmds.find((c) => re.test(c) && !/save-as|preview/.test(c)) ?? base
    }
  }
  const refresh = () => { resolveQuick(); updateStates(panel); for (const q of bar.querySelectorAll('.ae-qa')) updateStates(q.parentElement === bar ? wrapOne(q) : q) }
  // updateStates looks for items inside an element: give it a tiny holder view of one quick button
  const wrapOne = (q) => ({ querySelectorAll: (sel) => (q.matches(sel) ? [q] : []) })
  const show = (id) => {
    current = id
    try { localStorage.setItem(KEY, id) } catch {}
    for (const t of tabs) t.classList.toggle('on', t.dataset.tab === id)
    document.body.classList.toggle('ae-ribbon-home', id === 'home')
    panel.textContent = ''
    closePop()
    const def = TABS.find((t) => t.id === id)
    panel.hidden = !def?.menus
    if (!def?.menus) { window.dispatchEvent(new Event('resize')); return }
    for (const m of def.menus) {
      const dd = bar.querySelector(`.menu-item[data-menu="${m}"] > .menu-dropdown`)
      if (!dd) continue
      for (const g of groupsOf(dd, openSub)) {
        const grp = document.createElement('div')
        grp.className = 'ae-grp'
        grp.append(...g)
        panel.append(grp)
      }
    }
    refresh()
    window.dispatchEvent(new Event('resize'))
  }
  for (const t of TABS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ae-tab'
    b.dataset.tab = t.id
    b.textContent = ko() ? t.ko : t.en
    b.onclick = () => show(t.id)
    tabs.push(b)
    bar.insertBefore(b, anchor)
  }
  bar.append(panel)
  // enabled states follow the caret / selection: refresh while the ribbon is on screen, and after every command
  bar.addEventListener('click', () => setTimeout(refresh, 60))
  setInterval(() => { if (!document.hidden) refresh() }, 1200)
  let saved = 'home'
  try { saved = localStorage.getItem(KEY) || 'home' } catch {}
  show(TABS.some((t) => t.id === saved) ? saved : 'home')
  installAllEditorTheme(bar)
  installHancomStandIns()
}

// [AllEditor] dark mode: the editor follows the app's 화면 테마 (설정 › 테마: 시스템 / 라이트 / 다크), and the paper
// follows 문서 배경 (설정: 화면 따라가기 / 라이트 / 다크) the way the Word editor's paper does. The pages are
// drawn on canvases, so a dark page is the drawn page with its lightness inverted (hues kept); the document
// itself is not changed, and printing / PDF / saving use the real colours.
const APP_SETTINGS = 'alleditor.settings'
const readApp = () => { try { return JSON.parse(localStorage.getItem(APP_SETTINGS) || '{}') } catch { return {} } }
const DARK_CSS = `
html.ae-doc-dark #scroll-content canvas.document-page-canvas,html.ae-doc-dark #scroll-content canvas{filter:invert(.9) hue-rotate(180deg)}
html.ae-doc-dark #scroll-content{background:#1b1b1d}
`
export function installAllEditorTheme(bar) {
  const style = document.createElement('style')
  style.textContent = DARK_CSS
  document.head.appendChild(style)
  const root = document.documentElement
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const syncUi = () => {
    const mode = ['light', 'dark', 'system'].includes(readApp().theme) ? readApp().theme : 'system'
    if (root.dataset.themeMode === mode) return
    // the studio's own theme command (보기 › 테마), so its settings and every part of its UI follow
    const item = bar.querySelector(`.md-item[data-cmd="view:theme-${mode}"]`)
    if (item) item.click()
  }
  const syncPaper = () => {
    const doc = readApp().documentTheme ?? 'follow'
    const uiDark = root.dataset.themeEffective ? root.dataset.themeEffective === 'dark' : mq.matches
    root.classList.toggle('ae-doc-dark', doc === 'dark' || (doc === 'follow' && uiDark))
  }
  const sync = () => { syncUi(); syncPaper() }
  syncPaper()
  setTimeout(sync, 0) // after the studio has finished starting
  mq.addEventListener?.('change', sync)
  addEventListener('storage', (e) => { if (e.key === APP_SETTINGS) sync() })
  new MutationObserver(syncPaper).observe(root, { attributes: true, attributeFilter: ['data-theme-effective'] })
  addEventListener('focus', sync)
}

// [AllEditor] 한컴 fonts the app cannot ship (함초롬체: no redistribution licence checked) are drawn with the bundled
// free look-alikes (studio/fonts): 바탕 계열 → 나눔명조, 돋움 계열 → 나눔고딕. The document keeps its font names.
const HANCOM_STANDINS = [
  [['함초롬바탕', '함초롱바탕', '한컴바탕', 'HCR Batang', '새바탕'], 'NanumMyeongjo'],
  [['함초롬돋움', '함초롱돋움', '한컴돋움', 'HCR Dotum', '새돋움', '한컴산뜻돋움'], 'NanumGothic'],
]
export function installHancomStandIns() {
  const rules = []
  for (const [names, file] of HANCOM_STANDINS) for (const name of names) for (const [w, f] of [[400, 'Regular'], [700, 'Bold']]) {
    rules.push(`@font-face{font-family:"${name}";src:local("${name}"),url("fonts/${file}-${f}.woff2") format("woff2");font-weight:${w};font-style:normal;font-display:block}`)
  }
  const style = document.createElement('style')
  style.textContent = rules.join('\n')
  document.head.appendChild(style)
  // load them now, so the first drawing of a page already has them; redraw once they arrive
  Promise.all(HANCOM_STANDINS.flatMap(([names]) => [document.fonts.load(`16px "${names[0]}"`, '가'), document.fonts.load(`bold 16px "${names[0]}"`, '가')]))
    .then(() => window.dispatchEvent(new Event('resize')), () => {})
}

// 처음 사용 안내 (shown once, and again from 설정), 개인정보 안내 and 오픈소스 라이선스 in 설정.
type El = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => HTMLElementTagNameMap[K]

const GUIDE_KEY = 'alleditor.guideSeen'
const STEPS_KO: Array<[string, string]> = [
  ['AllEditor에 오신 것을 환영합니다', '한글(HWP·HWPX), Word, PowerPoint, Excel, PDF 문서를 iPad에서 열고 고칩니다. Keynote·Pages·Numbers 파일은 편집할 수 있는 형식으로 바꿔 엽니다.'],
  ['문서는 AllEditor 폴더에', '파일 앱 › AllEditor 안에 종류별 폴더(HWPX, Word, PowerPoint, Excel, PDF…)로 저장됩니다. 위치는 설정 › 문서 저장 위치에서 iCloud 또는 iPad로 바꿀 수 있습니다.'],
  ['다른 곳의 파일 열기', '홈의 "파일 열기"로 고르면 AllEditor로 복사해 엽니다. 원본은 그대로 있습니다. .hwp는 .hwpx로, Keynote는 PowerPoint로 바꿔 엽니다. 저장하지 않고 닫으면 복사본을 지울지 묻습니다.'],
  ['저장', '자동 저장이 켜져 있으면 고친 내용이 저절로 저장되고, 앱을 나갈 때도 저장됩니다. 저장하지 않은 변경이 있는 탭을 닫으면 저장할지 묻습니다. 한글 문서의 저장 전 상태는 설정 › 이전 판으로 되돌리기에 남습니다.'],
  ['AI 도우미와 Apple Pencil', 'AI 도우미는 설정 › AI 연결에서 키를 넣으면 씁니다. Apple Pencil로 PDF에 필기할 수 있고, 두 손가락으로 문서를 확대합니다. 탭 이름을 길게 누르면 이름을 바꿉니다.'],
]
const STEPS_EN: Array<[string, string]> = [
  ['Welcome to AllEditor', 'Open and edit Hangul (HWP·HWPX), Word, PowerPoint, Excel and PDF documents on the iPad. Keynote, Pages and Numbers files open as editable copies.'],
  ['Documents live in the AllEditor folder', 'Files › AllEditor, in a folder per kind (HWPX, Word, PowerPoint, Excel, PDF…). Settings › Document location moves it between iCloud and the iPad.'],
  ['Opening files from elsewhere', 'Open a file from the home to copy it into AllEditor; the original stays. .hwp opens as .hwpx, Keynote as PowerPoint. Closing an unsaved copy asks whether to keep it.'],
  ['Saving', 'With autosave on, changes are saved by themselves, also when you leave the app. Closing a tab with unsaved changes asks first. The state of a Hangul document before each save is kept in Settings › Earlier versions.'],
  ['AI and Apple Pencil', 'The AI assistant works once a key is added in Settings › AI connection. Write on PDFs with Apple Pencil; pinch to zoom a document. Press and hold a tab\'s name to rename it.'],
]

export function showGuide(el: El, ko: boolean, force = false) {
  try { if (!force && localStorage.getItem(GUIDE_KEY)) return } catch {}
  const steps = ko ? STEPS_KO : STEPS_EN
  let i = 0
  const back = el('div', 'ae-ask-back'), box = el('div', 'ae-ask')
  const title = el('div', 'ae-ask-title'), body = el('div', 'ae-ask-body'), dots = el('div', 'ae-guide-dots')
  const row = el('div', 'ae-ask-row')
  const skip = el('button', '', ko ? '건너뛰기' : 'Skip'), prev = el('button', '', ko ? '이전' : 'Back'), next = el('button', 'primary')
  const close = () => { try { localStorage.setItem(GUIDE_KEY, String(Date.now())) } catch {}; back.remove() }
  const draw = () => {
    title.textContent = steps[i][0]; body.textContent = steps[i][1]
    dots.textContent = steps.map((_, k) => (k === i ? '●' : '○')).join(' ')
    prev.hidden = i === 0; next.textContent = i === steps.length - 1 ? (ko ? '시작하기' : 'Start') : (ko ? '다음' : 'Next')
  }
  skip.onclick = close; prev.onclick = () => { i--; draw() }; next.onclick = () => { if (i === steps.length - 1) close(); else { i++; draw() } }
  row.append(skip, el('span', 'gap'), prev, next)
  dots.style.cssText = 'text-align:center;opacity:.5;font-size:11px;letter-spacing:2px;margin:-6px 0 12px'
  box.append(title, body, dots, row); back.append(box); document.body.append(back); draw()
}

const LICENSES: Array<[string, string, string, string, string]> = [
  // [name ko, name en, license ko, license en, file]
  ['AllEditor', 'AllEditor', 'Apache-2.0', 'Apache-2.0', 'licenses/AllEditor-NOTICE.txt'],
  ['AllEditor', 'AllEditor', 'Apache License 2.0 전문', 'Apache License 2.0, full text', 'licenses/AllEditor-LICENSE.txt'],
  ['이음오피스 (IeumOffice) · GenOffice', 'IeumOffice · GenOffice', 'Apache-2.0', 'Apache-2.0', 'licenses/IeumOffice-NOTICE.txt'],
  ['이음오피스 (IeumOffice)', 'IeumOffice', 'Apache License 2.0 전문', 'Apache License 2.0, full text', 'licenses/IeumOffice-LICENSE.txt'],
  ['rhwp (한글 편집 엔진)', 'rhwp (the Hangul editing engine)', 'MIT', 'MIT', 'licenses/rhwp-LICENSE.txt'],
  ['rhwp가 쓰는 구성요소와 글꼴', 'Components and fonts rhwp uses', 'MIT · Apache-2.0 · OFL 등', 'MIT · Apache-2.0 · OFL and others', 'licenses/rhwp-THIRD_PARTY_LICENSES.txt'],
  ['Unicode 데이터', 'Unicode data', 'Unicode License', 'Unicode License', 'licenses/Unicode-LICENSE.txt'],
  ['함께 넣은 글꼴 (나눔, Noto, Pretendard, 고운, RHWP Old Hangul …)', 'Bundled fonts (Nanum, Noto, Pretendard, Gowun, RHWP Old Hangul…)', 'SIL Open Font License 1.1', 'SIL Open Font License 1.1', 'hwp/studio/fonts/README.md'],
]

function showText(el: El, title: string, url: string) {
  const back = el('div', 'ae-ask-back'), box = el('div', 'ae-ask')
  box.style.maxWidth = '720px'
  const pre = el('pre'); pre.style.cssText = 'max-height:65vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px ui-monospace,Menlo,monospace;margin:0 0 12px'
  pre.textContent = '…'
  const ok = el('button', 'primary', 'OK'); ok.onclick = () => back.remove()
  const row = el('div', 'ae-ask-row'); row.append(el('span', 'gap'), ok)
  box.append(el('div', 'ae-ask-title', title), pre, row); back.append(box); document.body.append(back)
  back.onclick = (e) => { if (e.target === back) back.remove() }
  const f: typeof fetch = (globalThis as any).__realFetch ?? fetch
  void f(new URL(url, location.href).href).then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((t) => { pre.textContent = t }, (e) => { pre.textContent = String(e) })
}

export function renderAbout(wrap: HTMLElement, el: El, ko: boolean) {
  const h1 = el('h2', '', ko ? '개인정보 안내' : 'Privacy'); h1.id = 'privacy'; wrap.append(h1)
  const p = el('div', 'group'); wrap.append(p)
  const lines = ko ? [
    'AllEditor에는 회원 계정, 서버, 사용 통계가 없습니다. 문서는 이 기기와 사용자가 고른 저장 위치(iCloud Drive 등)에만 있습니다.',
    'AI 도우미를 쓰면, 그때 요청한 내용과 필요한 문서 내용이 사용자가 연결한 AI 서비스(Google Gemini, OpenAI, Anthropic, BAZE 등)로 전송되며 그 회사의 정책을 따릅니다. AI 키는 이 기기 안에 보관됩니다.',
    '인쇄하면 문서가 고른 프린터로 전송됩니다. 진단 정보(오류 기록)는 이 기기 안에만 남고, 직접 복사하지 않는 한 밖으로 나가지 않습니다.',
  ] : [
    'AllEditor has no accounts, servers or usage statistics. Documents stay on this device and in the location you chose (such as iCloud Drive).',
    'When you use the AI assistant, your request and the document content it needs are sent to the AI service you connected (Google Gemini, OpenAI, Anthropic, BAZE…) under that company\'s policy. AI keys are kept on this device.',
    'Printing sends the document to the printer you chose. Diagnostics (error records) stay on this device unless you copy them yourself.',
  ]
  for (const l of lines) p.append(el('p', 'hint', l))

  const h2 = el('h2', '', ko ? '오픈소스 라이선스' : 'Open source licenses'); h2.id = 'licenses'; wrap.append(h2)
  const g = el('div', 'group'); wrap.append(g)
  for (const [nko, nen, lko, len, url] of LICENSES) {
    const name = ko ? nko : nen, kind = ko ? lko : len
    const row = el('div', 'fld'); const txt = el('span', 'fl'); txt.append(el('b', '', name), el('br'), el('small', 'nm', kind))
    const b = el('button', 'mini', ko ? '보기' : 'View'); b.onclick = () => showText(el, name, url)
    row.append(txt, b); g.append(row)
  }
  const again = el('button', 'mini', ko ? '처음 사용 안내 다시 보기' : 'Show the welcome guide again')
  again.onclick = () => showGuide(el, ko, true)
  const row = el('div', 'fld'); row.append(el('span', 'fl', ''), again); g.append(row)
}

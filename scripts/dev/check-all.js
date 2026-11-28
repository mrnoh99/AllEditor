// Whole-app check against the mock office:// (scripts/dev/mock-office.js) with the built office/ bundle:
//   node scripts/dev/check-all.js            (needs: npm i playwright, a Chromium for it)
// Opens every kind of document from the home list, makes new ones, edits and saves a 한글 document, imports .hwp /
// .docx / .keyx the way the 파일 열기 picker does, checks the home list, 설정, the backup folder and tab restore.
// Exit code 1 when a check fails. CI: .github/workflows/web-check.yml
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process')

const FIX = path.join(__dirname, 'fixtures')
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-check-')), DOCS = path.join(W, 'docs'), IN = path.join(W, 'in'), OUT = path.join(W, 'shots')
for (const d of ['Word', 'PowerPoint', 'Excel', 'PDF', 'HWPX', 'HWP', 'Keynote']) fs.mkdirSync(path.join(DOCS, d), { recursive: true })
fs.mkdirSync(IN); fs.mkdirSync(OUT)
const put = (src, dst) => fs.copyFileSync(path.join(FIX, src), path.join(DOCS, dst))
put('t.docx', 'Word/문서.docx'); put('t.pptx', 'PowerPoint/발표.pptx'); put('t.xlsx', 'Excel/표.xlsx'); put('t.pdf', 'PDF/자료.pdf'); put('t.hwpx', 'HWPX/한글문서.hwpx')
fs.copyFileSync(path.join(FIX, 't.hwp'), path.join(IN, '가져온.hwp')); fs.copyFileSync(path.join(FIX, 't.docx'), path.join(IN, '가져온.docx')); fs.copyFileSync(path.join(FIX, 't.keyx'), path.join(IN, '키노트.keyx'))

const results = []
const ok = (name, pass, info = '') => { results.push(pass); console.log(pass ? 'OK  ' : 'FAIL', name, info) }
const ls = (d) => { try { return fs.readdirSync(path.join(DOCS, d)).sort().join(',') } catch { return '-' } }

;(async () => {
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock-office.js'), DOCS], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 1500))
  const b = await chromium.launch()
  try {
    const p = await b.newPage({ viewport: { width: 1194, height: 834 }, locale: 'ko-KR' })
    const errs = []
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)))
    p.on('dialog', (d) => d.accept())
    const takeErrs = () => errs.splice(0)
    const tabs = () => p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((t) => t.textContent.replace('✕', '')))
    const frameOf = (app) => p.frames().find((x) => x.url().includes('/' + app + '/index.html'))
    const waitLoaded = async (app, max = 60) => {
      for (let i = 0; i < max; i++) {
        await p.waitForTimeout(1000)
        const f = frameOf(app); if (!f) continue
        const st = await f.evaluate(() => (document.getElementById('ae-loading') ? 'loading' : 'done')).catch(() => 'x')
        if (st === 'done' && i > 2) return i
      }
      return -1
    }
    const home = () => p.locator('#tabs .tab', { hasText: '홈' }).first().click().catch(() => {})
    const closeLast = async () => { await p.locator('#tabs .tab').last().locator('button, .x, .close').last().click(); await p.waitForTimeout(1500) }
    const row = (name) => p.locator('#homePane .row', { hasText: name }).first().locator('button.file')
    const imp = (file, name) => p.evaluate(([b64, n]) => { const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const i = document.getElementById('picker'); const dt = new DataTransfer(); dt.items.add(new File([u], n)); i.files = dt.files; i.dispatchEvent(new Event('change')) }, [fs.readFileSync(file).toString('base64'), name])

    await p.goto('http://localhost:8766/index.html'); await p.waitForTimeout(3500)
    const rows = await p.locator('#homePane .row').count()
    ok('홈 목록', rows >= 5, rows + '개'); ok('홈 오류 없음', !errs.length, takeErrs().join(' / '))

    for (const [name, app] of [['문서.docx', 'docs'], ['발표.pptx', 'slides'], ['표.xlsx', 'sheets'], ['자료.pdf', 'pdf'], ['한글문서.hwpx', 'hwp']]) {
      await row(name).click()
      const s = await waitLoaded(app), f = frameOf(app)
      const seen = f ? await f.evaluate(() => { let t = document.body.innerText.length, c = document.querySelectorAll('canvas').length; for (const fr of document.querySelectorAll('iframe')) { try { t += fr.contentDocument.body.innerText.length; c += fr.contentDocument.querySelectorAll('canvas').length } catch {} } return { t, c } }) : { t: 0, c: 0 }
      await p.screenshot({ path: path.join(OUT, `open-${app}.png`) })
      const e = takeErrs()
      ok(`열기 ${name}`, s >= 0 && (seen.t > 200 || seen.c > 0) && !e.length, `${s}s text ${seen.t} canvas ${seen.c} ${e.join(' / ')}`)
      await closeLast(); await home(); await p.waitForTimeout(500)
    }
    for (const app of ['hwp', 'docs', 'slides', 'sheets']) {
      await p.locator(`.newcard[data-app="${app}"]`).click()
      const s = await waitLoaded(app), e = takeErrs()
      ok(`새 문서 ${app}`, s >= 0 && !e.length, e.join(' / '))
      await closeLast(); await home(); await p.waitForTimeout(500)
    }
    {
      const file = path.join(DOCS, 'HWPX/한글문서.hwpx'), before = fs.statSync(file).mtimeMs
      await row('한글문서.hwpx').click(); await waitLoaded('hwp')
      const st = p.frames().find((f) => f.url().includes('/studio/'))
      await st.click('#scroll-content canvas', { position: { x: 300, y: 160 } }); await p.keyboard.type('점검'); await p.waitForTimeout(600)
      await p.mouse.click(447, 99); await p.waitForTimeout(6000)
      ok('한글 편집 후 저장', fs.statSync(file).mtimeMs > before, takeErrs().join(' / '))
      ok('저장 전 백업은 Backup 폴더에', ls('Backup/HWPX').includes('한글문서.hwpx.bak') && !ls('HWPX').includes('.bak'), `Backup/HWPX=${ls('Backup/HWPX')} HWPX=${ls('HWPX')}`)
      await closeLast(); takeErrs()
    }
    await imp(path.join(IN, '가져온.hwp'), '가져온.hwp'); await p.waitForTimeout(22000)
    ok('가져온 hwp → HWPX 변환, 원본 사본 유지', ls('HWPX').includes('가져온.hwpx') && ls('HWP').includes('가져온.hwp'), `HWP=${ls('HWP')} HWPX=${ls('HWPX')} ${(await tabs()).join('|')}`)
    await closeLast()
    const ask1 = await p.locator('.ae-ask').count()
    if (ask1) { await p.getByRole('button', { name: '저장 안 함', exact: true }).click(); await p.waitForTimeout(3000) }
    ok('저장 안 함 → 변환본만 삭제', ask1 === 1 && !ls('HWPX').includes('가져온.hwpx') && ls('HWP').includes('가져온.hwp'), `HWP=${ls('HWP')} HWPX=${ls('HWPX')}`)
    await imp(path.join(IN, '가져온.docx'), '가져온.docx'); await waitLoaded('docs')
    await closeLast(); const ask2 = await p.locator('.ae-ask').count()
    if (ask2) { await p.getByRole('button', { name: '저장', exact: true }).click(); await p.waitForTimeout(4000) }
    ok('가져온 docx: 저장 → 유지', ask2 === 1 && ls('Word').includes('가져온.docx') && !(await tabs()).some((t) => t.includes('가져온.docx')), `Word=${ls('Word')}`)
    await imp(path.join(IN, '키노트.keyx'), '키노트.keyx')
    const conv = await waitLoaded('slides', 60)
    ok('가져온 keyx → pptx 변환', conv >= 0 && ls('PowerPoint').includes('키노트.pptx'), `PowerPoint=${ls('PowerPoint')} ${takeErrs().join(' / ')}`)
    await closeLast(); if (await p.locator('.ae-ask').count()) { await p.getByRole('button', { name: '저장', exact: true }).click(); await p.waitForTimeout(2000) }
    await home(); await p.waitForTimeout(1500)
    const names = await p.evaluate(() => [...document.querySelectorAll('#homePane .row')].map((r) => r.querySelector('button.file')?.textContent || ''))
    ok('홈: 원본 폴더(HWP·Keynote)와 Backup은 숨김', !names.some((r) => /가져온\.hwp(?!x)|키노트\.keyx|\.bak/.test(r)), names.length + '개')
    await p.locator('button.gear').click(); await p.waitForTimeout(1500)
    const set = await p.evaluate(() => document.getElementById('settingsPane')?.innerText || '')
    ok('설정 화면 (저장 공간 정리·진단 정보 포함)', set.length > 200 && set.includes('저장 공간 정리') && set.includes('진단 정보'), takeErrs().join(' / '))
    // unsaved changes on close: a new document asks; with autosave off an edited document asks and 저장 keeps it;
    // with autosave on it is saved without asking
    {
      const setAuto = (on) => p.evaluate((v) => { const s = JSON.parse(localStorage.getItem('alleditor.settings') || '{}'); s.autoSave = { on: v, updatedAt: Date.now() }; localStorage.setItem('alleditor.settings', JSON.stringify(s)) }, on)
      await closeLast() // the 설정 tab opened above
      const typeIn = async (txt) => { await frameOf('docs').locator('[contenteditable="true"]').first().click(); await p.keyboard.type(txt); await p.waitForTimeout(1200) }
      await home(); await p.locator('.newcard[data-app="docs"]').click(); await waitLoaded('docs'); await typeIn('새 문서 내용')
      await closeLast(); const askNew = await p.locator('.ae-ask').count()
      if (askNew) { await p.getByRole('button', { name: '저장 안 함', exact: true }).click(); await p.waitForTimeout(1200) }
      ok('닫기: 새 문서에 쓴 내용 → 확인창', askNew === 1 && (await tabs()).length === 1, (await tabs()).join('|'))
      const file = path.join(DOCS, 'Word/문서.docx')
      await setAuto(false); await home(); await row('문서.docx').click(); await waitLoaded('docs')
      const size0 = fs.statSync(file).size; await typeIn('자동 저장 끔 고침')
      await closeLast(); const askOff = await p.locator('.ae-ask').count()
      if (askOff) { await p.getByRole('button', { name: '저장', exact: true }).click(); await p.waitForTimeout(4000) }
      ok('닫기: 자동 저장 끔, 고친 문서 → 확인창 → 저장', askOff === 1 && fs.statSync(file).size !== size0 && (await tabs()).length === 1, `size ${size0}→${fs.statSync(file).size}`)
      await setAuto(true); await home(); await row('문서.docx').click(); await waitLoaded('docs')
      const size1 = fs.statSync(file).size; await typeIn('자동 저장 켬 고침')
      await closeLast(); await p.waitForTimeout(3000); const askOn = await p.locator('.ae-ask').count()
      ok('닫기: 자동 저장 켬, 고친 문서 → 묻지 않고 저장', askOn === 0 && fs.statSync(file).size !== size1 && (await tabs()).length === 1, `size ${size1}→${fs.statSync(file).size}`)
      takeErrs()
    }
    const font = await p.evaluate(async () => (await fetch('/hwp/studio/fonts/RHWPOldHangul-Regular.woff2')).status)
    ok('옛한글 글꼴 포함', font === 200, String(font))
    await home(); await p.waitForTimeout(500)
    await row('문서.docx').click(); await waitLoaded('docs')
    await p.reload(); await p.waitForTimeout(4000)
    ok('다시 시작 후 탭 복원', (await tabs()).some((t) => t.includes('문서.docx')), (await tabs()).join('|'))
    ok('복원된 탭 내용 표시', (await waitLoaded('docs')) >= 0, takeErrs().join(' / '))
  } catch (e) { ok('점검 실행', false, String(e?.message ?? e).slice(0, 300)) }
  finally { await b.close(); mock.kill() }
  const bad = results.filter((x) => !x).length
  console.log(`\n== ${results.length - bad}/${results.length} OK  (screenshots: ${OUT})`)
  process.exit(bad ? 1 : 0)
})()

const { chromium } = require('playwright')
const S = process.env.OUT ?? '/tmp'
;(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true, locale: 'ko-KR' })
  const errs = []
  for (const [app, q] of [['docs', ''], ['slides', '?open=/Documents/t.pptx'], ['sheets', '?open=/Documents/t.xlsx'], ['pdf', '?open=/Documents/t.pdf']]) {
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(app + ' ' + e.message.slice(0, 120)))
    await p.goto(`http://localhost:8766/${app}/index.html${q}`); await p.waitForTimeout(6000)
    const st = async () => p.evaluate(() => { const d = document.querySelector('.ai-dock, aside.copilot'); const t = document.getElementById('ae-ai-toggle'); const r = t.getBoundingClientRect(); return `dock=${Math.round(d.getBoundingClientRect().width)} toggle@x=${Math.round(r.left)} ${t.getAttribute('aria-label')}` })
    const before = await st()
    if (app === 'docs') await p.screenshot({ path: S + '/toggle-open.png' })
    await p.click('#ae-ai-toggle'); await p.waitForTimeout(600)
    const after = await st()
    if (app === 'docs') await p.screenshot({ path: S + '/toggle-folded.png' })
    console.log(app, '|', before, '|', after)
    await p.close()
  }
  // remembered: a new page starts folded
  const p = await ctx.newPage(); await p.goto('http://localhost:8766/slides/index.html?open=/Documents/t.pptx'); await p.waitForTimeout(6000)
  console.log('reload slides', await p.evaluate(() => Math.round(document.querySelector('.ai-dock').getBoundingClientRect().width)))
  await p.screenshot({ path: S + '/toggle-slides-folded.png' })
  await p.click('#ae-ai-toggle'); await p.waitForTimeout(600)
  console.log('unfold slides', await p.evaluate(() => Math.round(document.querySelector('.ai-dock').getBoundingClientRect().width)))
  console.log(errs)
  await b.close()
})()

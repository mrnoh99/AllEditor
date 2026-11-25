const { chromium } = require('playwright'); const { execSync } = require('child_process')
;(async () => {
  const b = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] })
  const p = await b.newPage({ viewport: { width: 1194, height: 834 }, locale: 'ko-KR' })
  const cdp = await p.context().newCDPSession(p)
  await cdp.send('Performance.enable')
  const rss = () => { // renderer processes' resident memory (MB)
    const out = execSync("ps -eo rss,args | grep -E 'chrome.*--type=renderer' | grep -v grep | awk '{s+=$1} END {print s}'").toString().trim()
    return Math.round(Number(out) / 1024)
  }
  const heap = async () => { const m = (await cdp.send('Performance.getMetrics')).metrics; const g = (n) => m.find((x) => x.name === n)?.value ?? 0; return Math.round(g('JSHeapUsedSize') / 1048576) }
  const report = async (label) => { await p.waitForTimeout(2500); console.log(label.padEnd(34), 'JS heap', String(await heap()).padStart(5), 'MB | renderer RSS', String(rss()).padStart(5), 'MB') }
  await p.goto('http://localhost:8766/index.html'); await report('office home')
  const open = async (name) => { await p.locator('#tabs .tab .tl', { hasText: '홈' }).click(); await p.waitForTimeout(300); await p.locator('#homePane .files >> text=' + name).first().click(); await p.waitForTimeout(8000) }
  await open('t.pptx'); await report('+ PowerPoint (t.pptx)')
  await open('calc.xlsx'); await report('+ Excel (calc.xlsx)')
  await open('t.pdf'); await report('+ PDF (t.pdf)')
  await p.locator('#tabs .tab .tl', { hasText: '홈' }).click(); await p.locator('#homePane button.card.docs').click(); await p.waitForTimeout(8000); await report('+ Word (new)')
  for (let i = 2; i <= 4; i++) { await p.locator('#tabs .tab .tl', { hasText: '홈' }).click(); await p.locator('#homePane button.card.docs').click(); await p.waitForTimeout(7000) }
  await report('+ 3 more Word tabs (7 tabs)')
  // close all document tabs
  while (await p.locator('#tabs .tab .tx').count()) { await p.locator('#tabs .tab .tx').first().click(); await p.waitForTimeout(400) }
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); await report('all tabs closed (after GC)')
  await b.close()
})()

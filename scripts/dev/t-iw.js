const { chromium } = require('playwright'); const fsx = require('fs'); const F = '/tmp/claude-0/iwrepo/test/fixtures/'
;(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1100, height: 750 }, locale: 'ko-KR' })
  p.on('pageerror', e => console.log('PE', e.stack.slice(0,300))); p.on('dialog', d => d.accept())
  const seed = { 'k.key': F + 'keynote/current-keynote-15.3.1.key', 'n.numbers': F + 'numbers/current-numbers-15.3.1.numbers', 'p.pages': F + 'pages/current-pages-15.3.1.pages' }
  const s2 = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, fsx.readFileSync(v).toString('base64')]))
  await p.addInitScript((s) => { window.__seedFiles = s }, s2)
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1500)
  await p.screenshot({ path: '/tmp/claude-0/iw-home.png' })
  for (const [n, f] of [['k.key', 'k'], ['n.numbers', 'n'], ['p.pages', 'p']]) {
    await p.click('text=홈'); await p.click(`.nm:text-is("${n}")`); await p.waitForTimeout(9000); await p.screenshot({ path: `/tmp/claude-0/iw-${f}.png` })
  }
  await b.close()
})()

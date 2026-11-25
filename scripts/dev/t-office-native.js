const { chromium } = require('playwright')
;(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, locale: 'ko-KR' })
  await ctx.addInitScript(() => localStorage.setItem('alleditor.settings', JSON.stringify({ language: 'ko', printers: [{ id: 'abc', name: '거실 프린터', host: '192.168.0.20', protocol: 'auto' }] })))
  const errs = []
  const watch = (p, tag) => { p.on('pageerror', (e) => errs.push(tag + ' PAGE ' + e.message.slice(0, 160))); p.on('console', (m) => { if (m.type() === 'error' && !/local-fonts|favicon/.test(m.text())) errs.push(tag + ' CON ' + m.text().slice(0, 160)) }) }
  // suite home lists Documents through the native bridge
  const h = await ctx.newPage(); watch(h, 'home'); await h.goto('http://localhost:8766/index.html'); await h.waitForTimeout(2500)
  console.log('HOME:', (await h.locator('#homePane .files').innerText()).replace(/\s+/g, ' ').slice(0, 200))
  for (const f of ['t.pptx', 't.xlsx', 't.pdf']) {
    const app = { pptx: 'slides', xlsx: 'sheets', pdf: 'pdf' }[f.split('.')[1]]
    const p = await ctx.newPage(); watch(p, f)
    await p.goto(`http://localhost:8766/${app}/index.html?open=/Documents/${f}`); await p.waitForTimeout(7000)
    await p.screenshot({ path: `${process.env.OUT ?? '/tmp'}/open-${f}.png` })
    console.log(f, 'title:', await p.title(), '| text:', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 90))
    await p.close()
  }
  // docs: new doc, print to the configured IP printer -> AEPdf.render + AEPrint.directPrint over /__ae
  const d = await ctx.newPage(); watch(d, 'docs'); await d.goto('http://localhost:8766/docs/index.html'); await d.waitForTimeout(5000)
  console.log('print result', JSON.stringify(await d.evaluate(() => window.desktop.print(1, { deviceName: 'ip:abc', copies: 2, duplex: 'longEdge' }, { widthTwips: 11906, heightTwips: 16838 }))))
  console.log('native log:', await (await fetch('http://localhost:8766/__log')).text())
  console.log(errs.length + ' errors'); [...new Set(errs)].slice(0, 12).forEach((e) => console.log('  ', e))
  await b.close()
})()

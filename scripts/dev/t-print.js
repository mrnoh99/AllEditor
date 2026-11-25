const { chromium } = require('playwright'); const fsx = require('fs')
;(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, locale: 'ko-KR' })
  await ctx.exposeFunction('__aePdfHookNode', async (html, w, h) => {
    const p2 = await ctx.newPage(); await p2.setContent(html, { waitUntil: 'load' }); await p2.waitForTimeout(400)
    const pdf = await p2.pdf({ width: (w/72) + 'in', height: (h/72) + 'in', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } }); await p2.close(); return pdf.toString('base64')
  })
  await ctx.exposeFunction('__aePrintNode', async (info) => { console.log('PRINT JOB ->', JSON.stringify(info)) })
  await ctx.addInitScript(() => {
    window.__aePdfHook = (h, w, ht) => window.__aePdfHookNode(h, w, ht)
    window.__aePrintHook = async ({ pdf, job, cfg }) => window.__aePrintNode({ bytes: pdf.length, head: String.fromCharCode(...pdf.slice(0, 5)), job, cfg })
    localStorage.setItem('alleditor.settings', JSON.stringify({ language: 'ko', printers: [{ id: 'abc', name: '거실 프린터', host: '192.168.0.20', protocol: 'auto' }] }))
  })
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('PE', e.message.slice(0,200)))
  await p.addInitScript((s) => { window.__seedFiles = s }, { 'a.docx': fsx.readFileSync('/home/user/genspark-ai/genoffice/fixtures/generated/simple.docx').toString('base64') })
  await p.goto('http://localhost:8765/docs/index.html?open=/Documents/a.docx'); await p.waitForTimeout(5000)
  console.log('printers', JSON.stringify(await p.evaluate(() => window.desktop.listPrinters())))
  console.log('result', JSON.stringify(await p.evaluate(() => window.desktop.print(1, { deviceName: 'ip:abc', copies: 2, duplex: 'longEdge' }, { widthTwips: 11906, heightTwips: 16838 }))))
  // settings UI
  const h = await ctx.newPage(); await h.goto('http://localhost:8765/index.html'); await h.waitForTimeout(1500); await h.click('.gear'); await h.waitForTimeout(500)
  await h.evaluate(() => document.querySelector('h2:nth-of-type(3)')?.scrollIntoView()); await h.screenshot({ path: '/tmp/claude-0/printers.png' })
  await h.click('text=테스트 인쇄'); await h.waitForTimeout(1000)
  await b.close()
})()

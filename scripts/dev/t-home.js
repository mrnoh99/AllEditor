const { chromium } = require('playwright'); const fsx = require('fs')
;(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 700 }, locale: 'ko-KR' })
  p.on('pageerror', e => console.log('PE', e.stack.slice(0,300))); p.on('console', m => ['error'].includes(m.type()) && console.log('E', m.text().slice(0,200)))
  const seed = { 'a.docx': fsx.readFileSync('/home/user/genspark-ai/genoffice/fixtures/generated/simple.docx').toString('base64'), 't.pptx': fsx.readFileSync('/tmp/claude-0/fx/t.pptx').toString('base64') }
  await p.addInitScript((s) => { window.__seedFiles = s }, seed)
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1500)
  await p.screenshot({ path: '/tmp/claude-0/home1.png' })
  await p.click('text=a.docx'); await p.waitForTimeout(500)
  await p.click('text=홈'); await p.click('text=t.pptx'); await p.waitForTimeout(7000)
  await p.screenshot({ path: '/tmp/claude-0/home2.png' })
  await p.click('.gear'); await p.waitForTimeout(500); await p.screenshot({ path: '/tmp/claude-0/home3.png' })
  await b.close()
})()

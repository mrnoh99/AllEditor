const { chromium } = require('playwright'); const fsx = require('fs')
;(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 800 } })
  p.on('pageerror', e => console.log('PE', e.stack.slice(0,500))); p.on('console', m => ['error','warning'].includes(m.type()) && console.log(m.type(), m.text().slice(0,300)))
  p.on('dialog', d => { console.log('DIALOG:', d.message()); d.dismiss() })
  const data = fsx.readFileSync('/tmp/claude-0/fx/t.pdf').toString('base64')
  await p.addInitScript(([n, d]) => { window.__seedFiles = { [n]: d } }, ['t.pdf', data])
  await p.goto('http://localhost:8765/pdf/index.html?open=/Documents/t.pdf'); await p.waitForTimeout(5000)
  for (const f of ['docx','pptx','xlsx']) { await p.evaluate((f) => window.pdfApi.convertOffice(f), f); await p.waitForTimeout(500) }
  await b.close()
})()

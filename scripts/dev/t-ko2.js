const { chromium } = require('playwright'); const fsx = require('fs')
const files = { docs: '/home/user/genspark-ai/genoffice/fixtures/generated/simple.docx', sheets: '/tmp/claude-0/fx/t.xlsx', pdf: '/tmp/claude-0/fx/t.pdf' }
;(async () => {
  const b = await chromium.launch()
  for (const [app, f] of Object.entries(files)) {
    const p = await b.newPage({ viewport: { width: 1000, height: 300 }, locale: 'en-US' }); const n = f.split('/').pop()
    await p.addInitScript(([n, d]) => { window.__seedFiles = { [n]: d } }, [n, fsx.readFileSync(f).toString('base64')])
    await p.goto(`http://localhost:8765/${app}/index.html?open=/Documents/${n}`); await p.waitForTimeout(6000)
    console.log(app, (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 90)); await p.close()
  }
  await b.close()
})()

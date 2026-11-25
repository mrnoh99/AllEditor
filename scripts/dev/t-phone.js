const { chromium, devices } = require('playwright'); const fsx = require('fs')
const files = { docs: '/home/user/genspark-ai/genoffice/fixtures/generated/kitchen-sink.docx', slides: '/tmp/claude-0/fx/t.pptx', sheets: '/tmp/claude-0/fx/t.xlsx', pdf: '/tmp/claude-0/fx/t.pdf' }
;(async () => {
  const b = await chromium.launch()
  for (const app of (process.argv[2] ? [process.argv[2]] : Object.keys(files))) {
    const ctx = await b.newContext({ ...devices['iPhone 14'] }); const p = await ctx.newPage()
    p.on('pageerror', e => console.log(app, 'PE', e.message.slice(0,200)))
    const name = files[app].split('/').pop()
    await p.addInitScript(([n, d]) => { window.__seedFiles = { [n]: d } }, [name, fsx.readFileSync(files[app]).toString('base64')])
    await p.goto(`http://localhost:8765/${app}/index.html?open=${encodeURIComponent('/Documents/' + name)}`); await p.waitForTimeout(8000)
    await p.screenshot({ path: `/tmp/claude-0/ph-${app}.png` }); await ctx.close()
  }
  await b.close()
})()

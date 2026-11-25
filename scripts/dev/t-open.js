// usage: node t-open.js app localfile  — imports file into memfs via the real dialog path? uses ?open= with preloaded file
const { chromium } = require('playwright')
const fsx = require('fs')
const [,, app, file] = process.argv
;(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 800 } })
  p.on('pageerror', e => console.log('PE', e.stack.slice(0,500))); p.on('console', m => console.log(m.type(), m.text().slice(0,300)))
  // seed file into memfs before app boots: expose via init script writing localStorage hook? use window.__seed consumed by runtime
  const data = fsx.readFileSync(file).toString('base64'); const name = file.split('/').pop()
  await p.addInitScript(([n, d]) => { window.__seedFiles = { [n]: d } }, [name, data])
  await p.goto(`http://localhost:8765/${app}/index.html?open=${encodeURIComponent('/Documents/' + name)}`); await p.waitForTimeout(9000)
  await p.screenshot({path:`/tmp/claude-0/${app}-open.png`}); await b.close()
})()

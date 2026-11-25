const { chromium, devices } = require('playwright'); const fsx = require('fs')
const [,, app, file] = process.argv
;(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'] }); const p = await ctx.newPage()
  const name = file.split('/').pop()
  await p.addInitScript(([n, d]) => { window.__seedFiles = { [n]: d } }, [name, fsx.readFileSync(file).toString('base64')])
  await p.goto(`http://localhost:8765/${app}/index.html?open=${encodeURIComponent('/Documents/' + name)}`); await p.waitForTimeout(7000)
  console.log(await p.evaluate(() => {
    const out = []; const walk = (el, d) => { if (d > 4) return; const r = el.getBoundingClientRect(); if (r.width > 40 && r.height > 20) out.push(' '.repeat(d) + el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0,3).join('.') + ` ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`); [...el.children].forEach(c => walk(c, d + 1)) }
    walk(document.getElementById('root') || document.body, 0); return out.slice(0, 60).join('\n') + '\nscrollW=' + document.documentElement.scrollWidth
  }))
  await b.close()
})()

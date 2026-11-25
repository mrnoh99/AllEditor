const { chromium } = require('playwright'); const fsx = require('fs')
const [,, app, file, label] = process.argv
;(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, locale: 'ko-KR' })
  await ctx.exposeFunction('__aePdfHookNode', async (html, w, h) => {
    const p2 = await ctx.newPage(); await p2.setContent(html, { waitUntil: 'load' }); await p2.waitForTimeout(500)
    const pdf = await p2.pdf({ width: (w/72) + 'in', height: (h/72) + 'in', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } }); await p2.close()
    fsx.writeFileSync('/tmp/claude-0/out-' + app + '.pdf', pdf); console.log('PDF produced', pdf.length); return pdf.toString('base64')
  })
  await ctx.addInitScript(() => { window.__aePdfHook = (h, w, ht) => window.__aePdfHookNode(h, w, ht) })
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('PE', e.message.slice(0,200))); p.on('dialog', d => { console.log('DIALOG', d.message().slice(0,100)); d.accept() })
  await p.addInitScript(([n, d]) => { window.__seedFiles = { [n]: d } }, [file.split('/').pop(), fsx.readFileSync(file).toString('base64')])
  await p.goto(`http://localhost:8765/${app}/index.html?open=/Documents/${file.split('/').pop()}`); await p.waitForTimeout(7000)
  await p.click('text=파일'); await p.waitForTimeout(600); await p.screenshot({ path: `/tmp/claude-0/menu-${app}.png` })
  await p.click(`text=${label}`).catch(e => console.log('click fail', e.message.slice(0,80)))
  await p.waitForTimeout(6000); await p.screenshot({ path: `/tmp/claude-0/menu2-${app}.png` }); await b.close()
})()

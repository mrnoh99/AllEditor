// Usage: node scripts/dev/mock-office.js <docs-dir>  (port 8766). Stand-in for office:// of the Tauri app (src-tauri/src/office.rs).
// Mimics src-tauri/src/office.rs: static files from office/ + POST /__ae/<plugin>/<method>.
const http = require('http'), fs = require('fs'), path = require('path')
const ROOT = require('path').join(__dirname, '../../office'), DOCS = process.argv[2], SUP = DOCS + '-support'
fs.mkdirSync(DOCS, { recursive: true }); fs.mkdirSync(SUP, { recursive: true })
const log = []
const ai = { selected: 'auto', keys: {}, models: {} } // stand-in for the sealed 이음오피스 AI store
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname)
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (p.startsWith('/__ae/')) {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const [plugin, method] = p.slice(6).split('/'); const a = body ? JSON.parse(body) : {}
      log.push(plugin + '.' + method + ' ' + (a.path ?? ''))
      const base = a.dir === 'support' ? SUP : DOCS; const f = path.join(base, a.path ?? '')
      let out = {}
      try {
        if (method === 'readFile') out = { data: fs.readFileSync(f).toString('base64') }
        else if (method === 'writeFile') { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(a.data, 'base64')) }
        else if (method === 'rename') { const to = path.join(base, a.to); if (fs.existsSync(to)) throw new Error('exists'); fs.renameSync(f, to) }
        else if (method === 'deleteFile') fs.rmSync(f, { recursive: true })
        else if (method === 'readdir') out = { files: fs.existsSync(f) ? fs.readdirSync(f).map((n) => { const st = fs.statSync(path.join(f, n)); return { name: n, type: st.isDirectory() ? 'directory' : 'file', size: st.size, mtime: st.mtimeMs } }) : [] }
        else if (plugin === 'AEAi' && method === 'get') out = { selectedProvider: ai.selected, modelByProvider: ai.models, configuredProviders: Object.fromEntries(Object.keys(ai.keys).map((k) => [k, { hasKey: !!ai.keys[k], models: [] }])) }
        else if (plugin === 'AEAi' && method === 'set') { ai.selected = a.provider; if (a.apiKey !== undefined) ai.keys[a.provider] = a.apiKey; if (a.model) ai.models[a.provider] = a.model; out = { selectedProvider: ai.selected, modelByProvider: ai.models, configuredProviders: Object.fromEntries(Object.keys(ai.keys).map((k) => [k, { hasKey: !!ai.keys[k], models: [] }])) } }
        else if (plugin === 'AEAi' && method === 'export') { const ids = [...new Set([...Object.keys(ai.keys), ...Object.keys(ai.models)])]; out = { provider: ['auto', 'chatgpt'].includes(ai.selected) ? (Object.keys(ai.keys)[0] ?? 'gemini') : ai.selected, providers: Object.fromEntries(ids.map((k) => [k, { apiKey: ai.keys[k] ?? '', model: ai.models[k] ?? '' }])) } }
        else if (plugin === 'AEApp' && method === 'version') out = { version: '1.0.0', build: 'mock' }
        else if (plugin === 'AEPdf') out = { data: Buffer.from('%PDF-1.4 mock').toString('base64') }
        else if (plugin === 'AEPrint') out = { via: 'mock', completed: true }
        else if (plugin === 'AEShare') { log.push('share ' + a.name + ' ' + a.mime + ' ' + Buffer.from(a.data, 'base64').length + 'B') }
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out))
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message) })) }
    }); return
  }
  if (p === '/__log') { res.end(JSON.stringify(log)); return }
  const file = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p)
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; res.end('nf'); return }
    const ext = path.extname(file); res.setHeader('content-type', mime[ext] ?? 'application/octet-stream')
    // stand-in for the office:// origin check
    if (ext === '.html') buf = Buffer.from(String(buf).replace('<head>', '<head><script>window.__AE_NATIVE__="tauri"</script>'))
    res.end(buf)
  })
}).listen(8766, () => console.log('mock office on 8766'))

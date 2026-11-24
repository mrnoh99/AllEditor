// Builds the upstream GenOffice renderers as plain web apps and assembles www/ for Capacitor.
//   UPSTREAM_DIR=/path/to/genoffice node scripts/build-web.mjs   (skip cloning)
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PINNED = 'c57dc1a2a20a2af38cdaeedb536d86960d7eb382' // genspark-ai/genoffice
const upstream = process.env.UPSTREAM_DIR ?? join(root, '.upstream')
const APPS = (process.env.APPS ?? 'docs').split(',') // renderer apps to bundle
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

if (!existsSync(join(upstream, 'package.json'))) {
  run('git', ['clone', 'https://github.com/genspark-ai/genoffice', upstream], root)
  run('git', ['checkout', PINNED], upstream)
}
if (!existsSync(join(upstream, 'node_modules'))) {
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], upstream)
}

// 1. shim: replaces Electron preload (window.desktop) with Capacitor-backed implementation
const www = join(root, 'www')
rmSync(www, { recursive: true, force: true })
mkdirSync(www, { recursive: true })
const shimFile = join(www, 'desktop-shim.js')
await build({
  entryPoints: [join(root, 'shim/desktop-shim.ts')],
  bundle: true, format: 'iife', target: 'safari16', outfile: shimFile, minify: true,
})

// 2. renderers
for (const app of APPS) {
  const appDir = join(upstream, 'apps', app)
  const out = join(www, app)
  run('npx', ['vite', 'build', '--config', 'vite.renderer.config.ts', '--outDir', out,
    '--emptyOutDir', '--base', `./`], appDir)
  const idx = join(out, 'index.html')
  cpSync(shimFile, join(out, 'desktop-shim.js'))
  // shim must run before the app bundle (module scripts are deferred, classic ones are not)
  writeFileSync(idx, readFileSync(idx, 'utf8').replace('<head>', '<head><script src="./desktop-shim.js"></script>'))
}

// 3. launcher
cpSync(join(root, 'web/index.html'), join(www, 'index.html'))
console.log('www/ ready:', APPS.join(', '))

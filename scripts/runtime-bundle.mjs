// esbuild config that bundles an app's REAL preload + main-process IPC registration
// to run inside the WebView, with `electron` and node builtins swapped for shims.
import { build } from 'esbuild'
import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { existsSync, statSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rt = (f) => join(root, 'shim/runtime', f)
const req = createRequire(join(root, 'package.json'))

const STUB_NAMES = ('BlockList isIP isIPv4 isIPv6 lookup resolve resolve4 resolve6 Socket Server createServer connect request get Agent createConnection spawn spawnSync exec execSync execFile execFileSync fork ChildProcess Worker isMainThread parentPort workerData threadId MessageChannel MessagePort createInterface Interface Module createRequire builtinModules isBuiltin Console channel subscribe unsubscribe tracingChannel hasSubscribers isUint8Array isArrayBuffer isAnyArrayBuffer isTypedArray isPromise isRegExp isDate isNativeError isProxy isSet isMap isBoxedPrimitive isSharedArrayBuffer createContext runInContext runInNewContext runInThisContext Script STATUS_CODES METHODS globalAgent createSecureContext TLSSocket checkServerIdentity rootCertificates getHeapStatistics setFlagsFromString isSea DatabaseSync promises').split(' ')
const throwing = (name) => ({
  name: `stub-${name}`,
  setup(b) {
    b.onResolve({ filter: new RegExp(`^(node:)?(${name})$`) }, (a) => ({ path: a.path, namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `const mk=()=>{const f=function(){return undefined};return new Proxy(f,{get:(t,k)=>k==='__esModule'?false:k==='then'?undefined:k===Symbol.toPrimitive?()=>'stub':mk(),apply:()=>undefined,construct:()=>mk()})};const o={};for(const n of ${JSON.stringify(STUB_NAMES)})o[n]=mk();module.exports=o`,
      loader: 'js',
    }))
  },
})

const req3 = (rel) => {
  for (const ext of ['', '.ts', '/index.ts']) {
    const p = join(globalThis.__upstream, rel + ext)
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  throw new Error('cannot resolve @upstream/' + rel)
}
const req2 = (a) => {
  const spec = a.path.replace(/\?asset$/, '')
  if (spec.startsWith('.')) return resolve(a.resolveDir, spec)
  return createRequire(join(a.resolveDir, 'x.js')).resolve(spec)
}

export async function bundleRuntime({ upstream, entry, outfile, appendExports = {} }) {
  globalThis.__upstream = upstream
  await build({
    stdin: { contents: "import '"+rt('process.ts')+"';\n"+entry, resolveDir: upstream, loader: 'ts', sourcefile: 'entry.ts' },
    outfile, bundle: true, format: 'iife', target: 'safari16', platform: 'browser', minify: true,
    sourcemap: false, logLevel: 'warning', legalComments: 'none',
    nodePaths: [join(upstream, 'node_modules'), join(root, 'node_modules')],
    alias: {},
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', 'import.meta.url': '"file:///app/out/main/index.js"', 'import.meta.dirname': '"/app/out/main"', 'import.meta.filename': '"/app/out/main/index.js"' },
    loader: { '.wasm': 'binary', '.node': 'empty', '.png': 'dataurl', '.svg': 'text', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    plugins: [
      {
        name: 'append-exports',
        setup(b) {
          for (const [file, text] of Object.entries(appendExports))
            b.onLoad({ filter: new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, async (a) => ({
              contents: (await import('node:fs')).readFileSync(a.path, 'utf8') + '\n' + text, loader: 'ts', resolveDir: dirname(a.path) }))
        },
      },
      {
        name: 'electron+fs',
        setup(b) {
          b.onResolve({ filter: /^(node:)?process$/ }, () => ({ path: rt('process.ts') }))
          b.onResolve({ filter: /\?asset$/ }, (a) => ({ path: req2(a), namespace: 'asset' }))
          b.onLoad({ filter: /.*/, namespace: 'asset' }, async (a) => {
            const fsn = await import('node:fs')
            const name = a.path.split('/').pop()
            return { contents: `import { putAsset } from ${JSON.stringify(rt('assets.ts'))}; export default putAsset(${JSON.stringify('/app/assets/' + name)}, ${JSON.stringify(fsn.readFileSync(a.path).toString('base64'))})`, loader: 'js', resolveDir: dirname(a.path) }
          })
          // electron-vite `?modulePath` (a worker_threads script path): no Node workers in a WebView; callers fall
          // back or fail with a clear error when they try to start the worker
          b.onResolve({ filter: /\?modulePath$/ }, (a) => ({ path: a.path, namespace: 'modulepath' }))
          b.onLoad({ filter: /.*/, namespace: 'modulepath' }, (a) => ({ contents: 'export default ' + JSON.stringify('/app/workers/' + a.path.replace(/\?modulePath$/, '').split('/').pop() + '.js'), loader: 'js' }))
          b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
          b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: 'export default ' + JSON.stringify((await import('node:fs')).readFileSync(a.path, 'utf8')), loader: 'js' }))
          b.onResolve({ filter: /^undici$/ }, () => ({ path: rt('undici.ts') }))
          b.onResolve({ filter: /^@upstream\// }, (a) => ({ path: req3(a.path.slice('@upstream/'.length)) }))
          b.onResolve({ filter: /^(node:)?url$/ }, (a) => (a.importer.includes('shim/runtime/url.ts') ? undefined : { path: rt('url.ts') }))
          b.onResolve({ filter: /^(node:)?module$/ }, () => ({ path: rt('module.ts') }))
          b.onResolve({ filter: /(^|\/)font-scan$/ }, () => ({ path: rt('font-scan.ts') }))
          b.onResolve({ filter: /^(node:)?child_process$/ }, () => ({ path: rt('child_process.ts') }))
          b.onResolve({ filter: /^(node:)?readline$/ }, () => ({ path: rt('readline.ts') }))
          b.onResolve({ filter: /^(node:)?zlib$/ }, () => ({ path: rt('zlib.ts') }))
          b.onResolve({ filter: /^(node:)?crypto$/ }, () => ({ path: rt('crypto.ts') }))
          b.onResolve({ filter: /^(node:)?os$/ }, () => ({ path: rt('os.ts') }))
          b.onResolve({ filter: /^electron$/ }, () => ({ path: rt('electron.ts') }))
          b.onResolve({ filter: /^(node:)?fs(\/promises)?$/ }, (a) => ({ path: rt(a.path.endsWith('promises') ? 'fs-promises.ts' : 'fs.ts') }))
          b.onResolve({ filter: /^(electron-updater|electron-store|electron-log|electron-devtools-installer|@electron-toolkit\/.*)$/ }, () => ({ path: rt('electron.ts') }))
        },
      },
      throwing('worker_threads|net|http|https|tls|dns|dns/promises|cluster|inspector|v8|vm|repl|http2|dgram|readline/promises|stream/promises|timers/promises'),
      throwing('diagnostics_channel|console|util/types|sqlite|test|wasi|trace_events|domain|sea|sys'),
      {
        name: 'node-alias',
        setup(b) {
          const map = { events: 'events', util: 'util', buffer: 'buffer', path: 'path-browserify', 'path/posix': 'path-browserify', stream: 'stream-browserify',
            string_decoder: 'string_decoder', assert: 'assert', url: 'url', querystring: 'querystring-es3', punycode: 'punycode', timers: 'timers-browserify', constants: 'constants-browserify' }
          b.onResolve({ filter: /^(node:)?(events|util|buffer|path|path\/posix|stream|string_decoder|assert|url|querystring|punycode|timers|constants)$/ }, (a) => {
            const name = a.path.replace(/^node:/, '')
            return { path: req.resolve(map[name] + (name === 'util' || name === 'events' || name === 'buffer' || name === 'punycode' || name === 'string_decoder' || name === 'url' || name === 'assert' ? '/' : '')) }
          })
          b.onResolve({ filter: /^(node:)?(tty|perf_hooks|async_hooks)$/ }, () => ({ path: 'empty', namespace: 'stub' }))
        },
      },
    ],
  })
}

const env: Record<string, string> = { GENOFFICE_E2E: '1', GENOFFICE_ZOTERO: '0', HOME: '/home', TMPDIR: '/tmp' }
const p: any = (globalThis as any).process ?? {}
Object.assign(p, { env: Object.assign(env, p.env ?? {}), platform: 'linux', arch: 'arm64', version: 'v22.0.0',
  versions: { node: '22.0.0', electron: '43.0.0', chrome: '120' }, cwd: () => '/', pid: 1, argv: ['app'],
  execPath: '/app', resourcesPath: '/app/resources', type: 'renderer', browser: true,
  nextTick: (f: any, ...a: any[]) => queueMicrotask(() => f(...a)), hrtime: Object.assign((t?: [number, number]) => { const n = performance.now(); const s = Math.floor(n / 1000); const ns = Math.floor((n % 1000) * 1e6); return t ? [s - t[0], ns - t[1]] : [s, ns] }, { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }),
  memoryUsage: () => ({ rss: 0, heapUsed: 0, heapTotal: 0, external: 0 }), on: () => p, off: () => p, once: () => p, emit: () => false, emitWarning: () => {}, uptime: () => performance.now() / 1000 })
;(globalThis as any).process = p
export default p
export const { env: _e } = p

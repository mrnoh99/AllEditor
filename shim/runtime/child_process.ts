// `spawn` of the xlsx sidecar becomes an in-process wasm call; everything else is unavailable.
import { EventEmitter } from 'events'
import { xlsxRequest } from './xlsx-host'

class Pipe extends EventEmitter { setEncoding() {} }
export function spawn(bin: string) {
  if (!/xlsx-sidecar/.test(String(bin))) {
    const e: any = new Error(`spawn ${bin} ENOENT (not available on iOS)`); e.code = 'ENOENT'
    throw e
  }
  const child: any = new EventEmitter()
  child.stdout = new Pipe(); child.stderr = new Pipe(); child.killed = false; child.pid = 1
  let buf = ''
  child.stdin = Object.assign(new EventEmitter(), {
    write(data: string, cb?: (e?: Error) => void) {
      buf += data
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        if (!line.trim()) continue
        xlsxRequest(line).then((r) => { if (r) child.stdout.emit('data', r + '\n') },
          (e) => { console.error('[xlsx!]', e?.stack || e); child.stderr.emit('data', String(e) + '\n') })
      }
      cb?.(); return true
    },
  })
  child.kill = () => { child.killed = true; return true }
  return child
}
const unavailable = (n: string) => () => { throw new Error(`child_process.${n} unavailable on iOS`) }
export const exec = unavailable('exec'), execFile = unavailable('execFile'), execSync = unavailable('execSync'),
  execFileSync = unavailable('execFileSync'), fork = unavailable('fork'), spawnSync = unavailable('spawnSync')
export default { spawn, exec, execFile, execSync, execFileSync, fork, spawnSync }

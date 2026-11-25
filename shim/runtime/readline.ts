import { EventEmitter } from 'events'
export function createInterface(opts: { input: any }) {
  const rl: any = new EventEmitter(); let buf = ''
  opts.input?.on?.('data', (c: any) => {
    buf += String(c); let i: number
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); rl.emit('line', l) }
  })
  rl.close = () => { rl.emit('close') }
  return rl
}
export default { createInterface }

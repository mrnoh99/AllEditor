import { convertIwork, IWORK_EXT } from '/home/user/AllEditor/shim/iwork/convert'
import { DOMParser } from '@xmldom/xmldom'
import fs from 'node:fs'
const [,, f, out] = process.argv
const b = fs.readFileSync(f); const r = await convertIwork(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, IWORK_EXT[f.split('.').pop()!], () => new DOMParser() as any)
fs.writeFileSync(out + '.' + r.ext, r.bytes); console.log(f.split('/').pop(), '->', r.ext, r.bytes.length, r.notes)

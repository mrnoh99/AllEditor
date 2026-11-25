import * as z from 'browserify-zlib'
// @ts-ignore
import * as brotliNs from 'brotli/decompress.js'
const brotli: any = (brotliNs as any).default ?? brotliNs
const zz: any = z
const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
export const crc32 = (d: Uint8Array | string, init = 0) => { const b = typeof d === 'string' ? new TextEncoder().encode(d) : d; let c = ~init >>> 0; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0 }
export const brotliDecompressSync = (b: Uint8Array) => Buffer.from(brotli(Buffer.from(b)))
export const brotliCompressSync = () => { throw new Error('brotli compress unavailable') }
export const { gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync, unzipSync, gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw, unzip, createGzip, createGunzip, createDeflate, createInflate, createDeflateRaw, createInflateRaw, constants } = zz
export default { ...zz, crc32, brotliDecompressSync, brotliCompressSync }

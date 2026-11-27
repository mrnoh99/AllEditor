import * as z from 'browserify-zlib'
// @ts-ignore
import * as brotliNs from 'brotli/decompress.js'
const brotli: any = (brotliNs as any).default ?? brotliNs
const zz: any = z
const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
export const crc32 = (d: Uint8Array | string, init = 0) => { const b = typeof d === 'string' ? new TextEncoder().encode(d) : d; let c = ~init >>> 0; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0 }
export const brotliDecompressSync = (b: Uint8Array) => Buffer.from(brotli(Buffer.from(b)))
export const brotliCompressSync = () => { throw new Error('brotli compress unavailable') }
// Node's zlib takes any Uint8Array (and ArrayBuffer views); browserify-zlib only a Buffer or string and throws
// "Not a string or buffer" otherwise (e.g. the print preview deflating raw page pixels). Hand it a Buffer view.
const asBuf = (b: any) => (b == null || typeof b === 'string' || Buffer.isBuffer(b) ? b
  : ArrayBuffer.isView(b) ? Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  : b instanceof ArrayBuffer ? Buffer.from(b) : b)
const wrap = (f: any) => (typeof f === 'function' ? (b: any, ...rest: any[]) => f(asBuf(b), ...rest) : f)
export const gzipSync = wrap(zz.gzipSync), gunzipSync = wrap(zz.gunzipSync), deflateSync = wrap(zz.deflateSync), inflateSync = wrap(zz.inflateSync)
export const deflateRawSync = wrap(zz.deflateRawSync), inflateRawSync = wrap(zz.inflateRawSync), unzipSync = wrap(zz.unzipSync)
export const gzip = wrap(zz.gzip), gunzip = wrap(zz.gunzip), deflate = wrap(zz.deflate), inflate = wrap(zz.inflate), deflateRaw = wrap(zz.deflateRaw), inflateRaw = wrap(zz.inflateRaw), unzip = wrap(zz.unzip)
export const { createGzip, createGunzip, createDeflate, createInflate, createDeflateRaw, createInflateRaw, constants } = zz
export default { ...zz, gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync, unzipSync, gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw, unzip, crc32, brotliDecompressSync, brotliCompressSync }

import * as u from 'url'
const x: any = u
export const fileURLToPath = (v: string | URL) => { const s = typeof v === 'string' ? v : v.href; return decodeURIComponent(s.replace(/^file:\/\/[^/]*/, '')) }
export const pathToFileURL = (p: string) => new URL('file://' + encodeURI(p).replace(/[?#]/g, encodeURIComponent))
export const URL = globalThis.URL
export const URLSearchParams = globalThis.URLSearchParams
export const domainToASCII = (d: string) => d
export const domainToUnicode = (d: string) => d
export const { parse, format, resolve, resolveObject, Url } = x
export default { ...x, fileURLToPath, pathToFileURL, URL, URLSearchParams, domainToASCII, domainToUnicode }

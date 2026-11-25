import * as cb from 'crypto-browserify'
const c: any = cb
export const randomUUID = () => (globalThis.crypto as any).randomUUID()
export const randomInt = (a: number, b?: number) => { const [lo, hi] = b === undefined ? [0, a] : [a, b]; return lo + Math.floor(Math.random() * (hi - lo)) }
export class X509Certificate { constructor() { throw new Error('X509 unavailable on iOS') } }
export const verify = () => { throw new Error('crypto.verify unavailable on iOS') }
export const { createHash, createHmac, randomBytes, pbkdf2Sync, pbkdf2, createCipheriv, createDecipheriv, createSign, createVerify, getHashes, getCiphers, publicEncrypt, privateDecrypt, scryptSync, timingSafeEqual, createECDH, createDiffieHellman, getRandomValues, constants, webcrypto, subtle, sign, getCurves, hkdfSync } = c
export default { ...c, randomUUID, randomInt, X509Certificate, verify }

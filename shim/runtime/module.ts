// node:module — only createRequire().resolve for the wasm assets the apps look up
export function createRequire(_from?: unknown) {
  const req: any = (name: string) => { throw new Error(`require('${name}') unavailable on iOS`) }
  req.resolve = (name: string) => {
    if (/pdfium\.wasm$/.test(name)) return '/app/wasm/pdfium.wasm'
    if (name === 'harfbuzzjs') return '/app/wasm/index.js'
    throw new Error(`Cannot resolve ${name}`)
  }
  return req
}
export const builtinModules: string[] = []
export const isBuiltin = () => false
export default { createRequire, builtinModules, isBuiltin }

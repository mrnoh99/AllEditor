import fs from './fs'
/** materialise an embedded asset into memfs so `readFileSync(path)` code finds it */
export function putAsset(path: string, b64: string): string {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    const bin = atob(b64); const u = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
    fs.writeFileSync(path, u)
  }
  return path
}

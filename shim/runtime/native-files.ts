// Thin JS side of AEFilesPlugin (ios/App/App/AppDelegate.swift); same shape as @capacitor/filesystem.
// Directory.Documents = app Documents (visible in Files.app); Directory.Support = private app data.
import { registerPlugin } from '@capacitor/core'

type Dir = 'documents' | 'support'
interface AEFiles {
  readFile(o: { path: string; dir: Dir }): Promise<{ data: string }>
  writeFile(o: { path: string; data: string; dir: Dir }): Promise<void>
  deleteFile(o: { path: string; dir: Dir }): Promise<void>
  readdir(o: { path: string; dir: Dir }): Promise<{ files: Array<{ name: string; type: string; size: number; mtime: number }> }>
}
const plugin = registerPlugin<AEFiles>('AEFiles')

export const Directory = { Documents: 'documents', Support: 'support' } as const
type D = (typeof Directory)[keyof typeof Directory]
const dir = (d?: string): Dir => (d === 'support' ? 'support' : 'documents')
export const Filesystem = {
  readFile: (o: { path: string; directory?: D }) => plugin.readFile({ path: o.path, dir: dir(o.directory) }),
  writeFile: (o: { path: string; directory?: D; data: string; recursive?: boolean }) => plugin.writeFile({ path: o.path, data: o.data, dir: dir(o.directory) }),
  deleteFile: (o: { path: string; directory?: D }) => plugin.deleteFile({ path: o.path, dir: dir(o.directory) }),
  readdir: (o: { path: string; directory?: D }) => plugin.readdir({ path: o.path, dir: dir(o.directory) }),
}

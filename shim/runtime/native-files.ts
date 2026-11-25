// Thin JS side of AEFilesPlugin (ios/App/App/AppDelegate.swift); same shape as @capacitor/filesystem.
import { registerPlugin } from '@capacitor/core'

interface AEFiles {
  readFile(o: { path: string }): Promise<{ data: string }>
  writeFile(o: { path: string; data: string }): Promise<void>
  deleteFile(o: { path: string }): Promise<void>
  readdir(o: { path: string }): Promise<{ files: Array<{ name: string; type: string; size: number; mtime: number }> }>
}
const plugin = registerPlugin<AEFiles>('AEFiles')

export const Directory = { Documents: 'DOCUMENTS' } as const
export const Filesystem = {
  readFile: (o: { path: string; directory?: string }) => plugin.readFile({ path: o.path }),
  writeFile: (o: { path: string; directory?: string; data: string; recursive?: boolean }) => plugin.writeFile({ path: o.path, data: o.data }),
  deleteFile: (o: { path: string; directory?: string }) => plugin.deleteFile({ path: o.path }),
  readdir: (o: { path: string; directory?: string }) => plugin.readdir({ path: o.path }),
}

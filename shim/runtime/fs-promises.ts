import fs from './fs'
const p: any = fs.promises
export default p
export const { readFile, writeFile, mkdir, readdir, stat, lstat, unlink, rm, rmdir, rename, copyFile, appendFile, access, realpath, open, utimes, chmod, mkdtemp, cp, truncate, symlink, readlink } = p

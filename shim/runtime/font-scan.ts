// No readable system font directories on iOS: report every scan task as "not finished"
// so callers fall back to the bundled fonts / heuristic metrics.
export type ScanTask = any
export type ScanResult = any
export function scanFontDirs(tasks: any[], _deadlineMs: number): any[] { return new Array(tasks.length) }

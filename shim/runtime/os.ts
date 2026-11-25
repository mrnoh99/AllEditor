export const userInfo = () => ({ username: 'user', uid: 501, gid: 20, shell: '', homedir: '/home' })
export const platform = () => 'linux'; export const type = () => 'Linux'; export const arch = () => 'arm64'
export const homedir = () => '/home'; export const tmpdir = () => '/tmp'; export const hostname = () => 'ios'
export const cpus = () => Array.from({ length: Math.max(1, navigator.hardwareConcurrency || 2) }, () => ({ model: 'cpu', speed: 0 }))
export const totalmem = () => 4 * 2 ** 30; export const freemem = () => 2 ** 30; export const release = () => '1'
export const endianness = () => 'LE'; export const EOL = '\n'; export const networkInterfaces = () => ({}); export const availableParallelism = () => cpus().length
export const uptime = () => performance.now() / 1000; export const loadavg = () => [0, 0, 0]; export const version = () => '1'; export const devNull = '/dev/null'
// no process priorities in a WebView; signal / priority numbers as on Darwin
export const constants = { signals: { SIGINT: 2, SIGTERM: 15, SIGKILL: 9, SIGHUP: 1 }, errno: {}, priority: { PRIORITY_LOW: 19, PRIORITY_BELOW_NORMAL: 10, PRIORITY_NORMAL: 0, PRIORITY_ABOVE_NORMAL: -7, PRIORITY_HIGH: -14, PRIORITY_HIGHEST: -20 } }
export const setPriority = () => {}; export const getPriority = () => 0
export default { constants, setPriority, getPriority, userInfo, platform, type, arch, homedir, tmpdir, hostname, cpus, totalmem, freemem, release, endianness, EOL, networkInterfaces, availableParallelism, uptime, loadavg, version, devNull }

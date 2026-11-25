#!/usr/bin/env node
/**
 * AllEditor: post-process Tauri's generated Xcode project (src-tauri/gen/apple) so that
 *  1. it targets iPhone AND iPad (TARGETED_DEVICE_FAMILY "1,2"; iPad: landscape, full screen), and
 *  2. it opens and runs straight from Xcode with no Node / npm / Rust installed: the "Build Rust Code"
 *     phase copies the committed prebuilt static library (Prebuilt/<platform>/libapp.a) instead of running
 *     `npm run -- tauri ios xcode-script`. Set AE_BUILD_RUST=1 (or delete Prebuilt/) to build Rust from source.
 * Idempotent. macOS only (uses /usr/libexec/PlistBuddy). Run after `tauri ios init` + apply-native-config.mjs.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APPLE = join(APP_DIR, 'src-tauri', 'gen', 'apple')
if (!existsSync(APPLE)) throw new Error('src-tauri/gen/apple not found — run `tauri ios init --ci` first')

const proj = readdirSync(APPLE).find((n) => n.endsWith('.xcodeproj'))
if (!proj) throw new Error('no .xcodeproj in gen/apple')
const pbxPath = join(APPLE, proj, 'project.pbxproj')
let pbx = readFileSync(pbxPath, 'utf8')

// 1. iPhone + iPad
const famCount = (pbx.match(/TARGETED_DEVICE_FAMILY = [^;]*;/g) || []).length
if (famCount > 0) {
  pbx = pbx.replace(/TARGETED_DEVICE_FAMILY = [^;]*;/g, 'TARGETED_DEVICE_FAMILY = "1,2";')
} else {
  // no explicit value: add it next to every IPHONEOS_DEPLOYMENT_TARGET / SDKROOT = iphoneos build setting
  const before = pbx
  pbx = pbx.replace(/(\n(\s*)SDKROOT = iphoneos;)/g, '$1\n$2TARGETED_DEVICE_FAMILY = "1,2";')
  if (pbx === before) throw new Error('could not set TARGETED_DEVICE_FAMILY')
}

// 2. Prebuilt Rust library wrapper
const re = /shellScript = "((?:\\.|[^"\\])*tauri ios xcode-script(?:\\.|[^"\\])*)";/
const m = re.exec(pbx)
const WRAP_CALL = 'shellScript = "/bin/sh \\"${SRCROOT}/scripts/build-rust.sh\\"\\n";'
const wrapperPath = join(APPLE, 'scripts', 'build-rust.sh')
const MARK = '# --- from source (Tauri CLI) ---'
let original
if (m) {
  original = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim()
  pbx = pbx.replace(re, WRAP_CALL)
} else if (pbx.includes('scripts/build-rust.sh') && existsSync(wrapperPath)) {
  // already wrapped: recover the from-source command (last line of the existing wrapper)
  const lines = readFileSync(wrapperPath, 'utf8').trimEnd().split('\n')
  original = lines[lines.length - 1].trim()
  if (!original.includes('tauri ios xcode-script')) throw new Error('cannot recover the Tauri command from build-rust.sh')
} else {
  throw new Error('"Build Rust Code" phase (tauri ios xcode-script) not found in project.pbxproj')
}
writeFileSync(pbxPath, pbx)

// 2b. AllEditor office suite (Word / PowerPoint / Excel / PDF web apps, repository folder ios/App/App/public):
// a folder reference copied into the app bundle as `public/`, served on office:// by src-tauri/src/office.rs.
const OFFICE_REF = 'AE0FF1CE0000000000000001', OFFICE_BUILD = 'AE0FF1CE0000000000000002'
const OFFICE_PATH = '../../../../../../ios/App/App/public'
if (!pbx.includes(OFFICE_REF)) {
  const add = (re, text, what) => {
    const before = pbx
    pbx = pbx.replace(re, (m) => m + text)
    if (pbx === before) throw new Error('could not add the office folder: ' + what)
  }
  add(/\/\* Begin PBXBuildFile section \*\/\n/, `\t\t${OFFICE_BUILD} /* office in Resources */ = {isa = PBXBuildFile; fileRef = ${OFFICE_REF} /* office */; };\n`, 'build file')
  add(/\/\* Begin PBXFileReference section \*\/\n/, `\t\t${OFFICE_REF} /* office */ = {isa = PBXFileReference; lastKnownFileType = folder; name = office; path = "${OFFICE_PATH}"; sourceTree = SOURCE_ROOT; };\n`, 'file reference')
  add(/\t\t\t\t[0-9A-F]{24} \/\* assets \*\/,\n/, `\t\t\t\t${OFFICE_REF} /* office */,\n`, 'group child')
  add(/\t\t\t\t[0-9A-F]{24} \/\* assets in Resources \*\/,\n/, `\t\t\t\t${OFFICE_BUILD} /* office in Resources */,\n`, 'resources phase')
  writeFileSync(pbxPath, pbx)
}

mkdirSync(join(APPLE, 'scripts'), { recursive: true })
mkdirSync(join(APPLE, 'Prebuilt', 'iphoneos'), { recursive: true })
mkdirSync(join(APPLE, 'Prebuilt', 'iphonesimulator'), { recursive: true })
// The project has a folder reference to `assets` (bundle resources) that the Tauri CLI normally creates during
// the build; keep it in git so a prebuilt-only build finds it.
mkdirSync(join(APPLE, 'assets'), { recursive: true })
if (readdirSync(join(APPLE, 'assets')).length === 0) writeFileSync(join(APPLE, 'assets', '.gitkeep'), '')
writeFileSync(
  wrapperPath,
  `#!/bin/sh
# AllEditor — "Build Rust Code" phase.
# Default: use the committed prebuilt Rust library (built by CI from this repo's sources) so the project runs
# from Xcode without Node/npm/Rust. It is stored gzip-compressed and split into < 100 MB parts for GitHub:
#   Prebuilt/$PLATFORM_NAME/libapp.a.gz.part-aa, -ab, …  → joined with cat | gunzip (built into macOS).
# AE_BUILD_RUST=1 (env or Xcode build setting), or no prebuilt parts: build from source with the Tauri CLI
# (needs Node >= 22, Rust + iOS targets, and \`npm ci\` + the web build in ieumoffice-ios/ — see README-IOS.md).
set -e
mkdir -p "$SRCROOT/assets"
DIR="$SRCROOT/Prebuilt/$PLATFORM_NAME"
if [ "\${AE_BUILD_RUST:-0}" != "1" ] && ls "$DIR"/libapp.a.gz.part-* >/dev/null 2>&1; then
  CACHE="$SRCROOT/Externals/prebuilt-$PLATFORM_NAME.a"
  STAMP="$SRCROOT/Externals/prebuilt-$PLATFORM_NAME.sha"
  SUM=$(cat "$DIR"/libapp.a.gz.part-* | /usr/bin/shasum | cut -d' ' -f1)
  if [ ! -f "$CACHE" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$SUM" ]; then
    mkdir -p "$SRCROOT/Externals"
    cat "$DIR"/libapp.a.gz.part-* | /usr/bin/gunzip -c > "$CACHE.tmp"
    mv -f "$CACHE.tmp" "$CACHE"
    echo "$SUM" > "$STAMP"
  fi
  for arch in $ARCHS; do
    if [ "$arch" != "arm64" ]; then
      echo "error: the prebuilt Rust library is arm64 only (asked for $arch). Use an Apple-silicon Mac / arm64 simulator, or set AE_BUILD_RUST=1."
      exit 1
    fi
    mkdir -p "$SRCROOT/Externals/$arch/$CONFIGURATION"
    cp -f "$CACHE" "$SRCROOT/Externals/$arch/$CONFIGURATION/libapp.a"
  done
  echo "AllEditor: using prebuilt Rust library from $DIR"
  exit 0
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"
${MARK}
${original}
`,
)
try { chmodSync(wrapperPath, 0o755) } catch {}

// Build outputs never go into git (the committed library lives in Prebuilt/, not Externals/).
const giPath = join(APPLE, '.gitignore')
let gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : ''
for (const line of ['Externals/', 'build/', 'xcuserdata/', 'DerivedData/', '*.xcuserstate', 'Prebuilt/*/libapp.a', 'Prebuilt/*/libapp.a.gz']) {
  if (!gi.split(/\r?\n/).includes(line)) gi += (gi && !gi.endsWith('\n') ? '\n' : '') + line + '\n'
}
writeFileSync(giPath, gi)

// Keep project.yml (XcodeGen source) in sync so a regeneration keeps the wrapper.
const ymlPath = join(APPLE, 'project.yml')
if (existsSync(ymlPath)) {
  let yml = readFileSync(ymlPath, 'utf8')
  yml = yml.replace(/(- script: )npm run -- tauri ios xcode-script.*$/m, '$1/bin/sh "${SRCROOT}/scripts/build-rust.sh"')
  if (!/TARGETED_DEVICE_FAMILY/.test(yml)) {
    yml = yml.replace(/(\n(\s+)base:\n)/, `$1$2  TARGETED_DEVICE_FAMILY: "1,2"\n`)
  }
  writeFileSync(ymlPath, yml)
}

// 3. Info.plist: all iPad orientations (required for iPad multitasking), no full-screen requirement
const plistDir = readdirSync(APPLE, { withFileTypes: true }).find(
  (d) => d.isDirectory() && existsSync(join(APPLE, d.name, 'Info.plist')),
)
if (!plistDir) throw new Error('Info.plist not found under gen/apple')
const plist = join(APPLE, plistDir.name, 'Info.plist')
const pb = (cmd) => execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { stdio: 'pipe' })
const tryPb = (cmd) => { try { pb(cmd) } catch {} }
// AllEditor (user decision): iPad runs landscape, full screen (no Split View / Slide Over), status bar hidden
tryPb('Delete :UISupportedInterfaceOrientations~ipad')
pb('Add :UISupportedInterfaceOrientations~ipad array')
for (const o of ['LandscapeLeft', 'LandscapeRight']) {
  pb(`Add :UISupportedInterfaceOrientations~ipad: string UIInterfaceOrientation${o}`)
}
tryPb('Delete :UIRequiresFullScreen')
pb('Add :UIRequiresFullScreen bool true')
tryPb('Delete :UIStatusBarHidden~ipad')
pb('Add :UIStatusBarHidden~ipad bool true')
tryPb('Delete :UIViewControllerBasedStatusBarAppearance')
pb('Add :UIViewControllerBasedStatusBarAppearance bool false')
// office suite: documents visible in Files › AllEditor, local-network permission for direct (IPP / 9100) printing
tryPb('Delete :UIFileSharingEnabled')
pb('Add :UIFileSharingEnabled bool true')
tryPb('Delete :NSLocalNetworkUsageDescription')
pb('Add :NSLocalNetworkUsageDescription string 네트워크 프린터로 바로 인쇄하려면 같은 네트워크의 프린터에 연결해야 합니다. (Needed to print directly to a printer on your network.)')
tryPb('Delete :NSBonjourServices')
pb('Add :NSBonjourServices array')
for (const svc of ['_ipp._tcp', '_ipps._tcp', '_pdl-datastream._tcp']) pb(`Add :NSBonjourServices: string ${svc}`)

console.log(`AllEditor Xcode setup done: ${proj} (iPhone+iPad), wrapper ${original ? 'written' : 'kept'}, ${plist}`)

// AllEditor app shell. The whole app is the office suite (Word · PowerPoint · Excel · PDF · 한글), served by the Rust
// side on office:// (src-tauri/src/office.rs) and shown full screen by OfficeOverlay. Its home (shim/home/home.ts)
// is the app's home; its settings hold the language, theme and the one AI setting.
//
// 이음오피스's own mobile screens (HWP / Markdown editor, its home and settings) were here before; they were unused
// once 한글 moved into the office suite and were removed (HANDOFF.md §0f).
import { normalizeLang, type Lang } from '@genoffice/i18n'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import { OfficeOverlay } from './components/OfficeSuite'
import { MobileLocaleProvider } from './i18n'

export interface MobileAppProps {
  /** kept for the tests' injected transport; the office suite talks to the Rust side itself */
  readonly client?: MobileClient
}

/** Korean by default, English when the office settings choose it */
function appLang(): Lang {
  try {
    const s = JSON.parse(localStorage.getItem('alleditor.settings') || '{}') as { language?: string }
    if (s.language) return normalizeLang(s.language) === 'en' ? 'en' : 'ko'
  } catch {}
  return 'ko'
}

export function MobileApp(_props: MobileAppProps) {
  return (
    <MobileLocaleProvider lang={appLang()}>
      <OfficeOverlay active />
    </MobileLocaleProvider>
  )
}

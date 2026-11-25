// AllEditor: Word / PowerPoint / Excel / PDF (+ Pages·Keynote·Numbers import, PDF tools, printing).
// The office suite is a separate web app bundled with the iOS app and served by the Rust side on the
// `office://` scheme (src-tauri/src/office.rs). It runs in a full-screen overlay iframe that stays alive
// while hidden, so open office tabs survive a trip back to the 이음오피스 home.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMobileLocale } from '../i18n'
import { IconChevronRight, IconFolderOpen } from './MobileIcons'

type OfficeApp = 'docs' | 'slides' | 'sheets'
type OfficeAction =
  | { action: 'home' }
  | { action: 'new'; app: OfficeApp }
  | { action: 'import'; name: string; data: string } // file handed over by another app (base64)

interface TauriGlobal {
  core?: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> }
  event?: { listen: (name: string, cb: () => void) => Promise<() => void> }
}
const tauri = (): TauriGlobal | undefined => (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__

const OPEN_EVENT = 'ae-office-open'

/** office:// on Apple platforms (WKWebView custom scheme), http://office.localhost elsewhere (Tauri convention) */
export function officeBaseUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  if (env?.VITE_AE_OFFICE_URL) return env.VITE_AE_OFFICE_URL
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return /iPhone|iPad|iPod|Macintosh/.test(ua) ? 'office://localhost/' : 'http://office.localhost/'
}

export function openOffice(detail: OfficeAction): void {
  window.dispatchEvent(new CustomEvent<OfficeAction>(OPEN_EVENT, { detail }))
}

const TEXT = {
  ko: {
    section: '오피스 문서',
    word: '새 Word 문서',
    ppt: '새 PowerPoint',
    excel: '새 Excel 시트',
    open: '오피스 파일 열기',
    openSub: 'Word · PowerPoint · Excel · PDF · Pages · Keynote · Numbers',
    close: '이음오피스 홈으로',
    loading: '오피스를 여는 중…',
  },
  en: {
    section: 'Office documents',
    word: 'New Word document',
    ppt: 'New PowerPoint',
    excel: 'New Excel sheet',
    open: 'Open office file',
    openSub: 'Word · PowerPoint · Excel · PDF · Pages · Keynote · Numbers',
    close: 'Back to IeumOffice home',
    loading: 'Opening office…',
  },
} as const

function useOfficeText() {
  const { lang } = useMobileLocale()
  return lang === 'ko' ? TEXT.ko : TEXT.en
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 38,
        height: 38,
        borderRadius: 9,
        background: color,
        color: '#fff',
        fontWeight: 700,
        fontSize: 17,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
      }}
    >
      {label}
    </span>
  )
}

const HOME_TEXT = {
  ko: {
    newSection: '새로 만들기',
    hwp: '새 한글 문서',
    word: '새 Word 문서',
    ppt: '새 PowerPoint',
    excel: '새 Excel 시트',
    open: '파일 열기',
    openSub: '한글 · Word · PowerPoint · Excel · PDF · Pages · Keynote · Numbers',
    library: '문서 보관함',
    librarySub: '파일 앱 › AllEditor 의 문서 (오피스 문서, PDF, 한글)',
  },
  en: {
    newSection: 'New',
    hwp: 'New Hangul document',
    word: 'New Word document',
    ppt: 'New PowerPoint',
    excel: 'New Excel sheet',
    open: 'Open a file',
    openSub: 'Hangul · Word · PowerPoint · Excel · PDF · Pages · Keynote · Numbers',
    library: 'Document library',
    librarySub: 'Documents in Files › AllEditor (office, PDF, Hangul)',
  },
} as const

/**
 * AllEditor home: one place for every document type — 한글 next to Word / PowerPoint / Excel, one "파일 열기"
 * (한글 opens in the HWP editor, everything else in the office suite) and the document library (office home).
 */
export function UnifiedHomeSection({
  hwpFormat,
  onNewHwp,
  onOpenAny,
}: {
  readonly hwpFormat: 'hwp' | 'hwpx'
  readonly onNewHwp: () => void
  readonly onOpenAny: () => void
}) {
  const { lang } = useMobileLocale()
  const s = lang === 'ko' ? HOME_TEXT.ko : HOME_TEXT.en
  const cards: Array<{ id: string; title: string; sub: string; label: string; color: string; run: () => void }> = [
    { id: 'hwp', title: s.hwp, sub: '.' + hwpFormat, label: '한', color: '#1d9bd1', run: onNewHwp },
    { id: 'docs', title: s.word, sub: '.docx', label: 'W', color: '#2b6cd4', run: () => openOffice({ action: 'new', app: 'docs' }) },
    { id: 'slides', title: s.ppt, sub: '.pptx', label: 'P', color: '#d24726', run: () => openOffice({ action: 'new', app: 'slides' }) },
    { id: 'sheets', title: s.excel, sub: '.xlsx', label: 'X', color: '#1e7145', run: () => openOffice({ action: 'new', app: 'sheets' }) },
  ]
  return (
    <section className="mobile-home-cta-group" aria-label={s.newSection} data-testid="home-unified">
      <h2 className="mobile-section-heading">{s.newSection}</h2>
      <div className="mobile-home-create-grid ae-home-grid4">
        {cards.map((c) => (
          <button key={c.id} type="button" className="mobile-quick-card" onClick={c.run} data-testid={`home-new-${c.id}`}>
            <Badge label={c.label} color={c.color} />
            <div className="mobile-quick-card-text">
              <span className="mobile-quick-card-title">{c.title}</span>
              <span className="mobile-quick-card-sub">{c.sub}</span>
            </div>
          </button>
        ))}
      </div>
      <button type="button" className="mobile-open-card" onClick={onOpenAny} data-testid="home-open-any">
        <span className="mobile-quick-folder" aria-hidden="true">
          <IconFolderOpen size={19} />
        </span>
        <span className="mobile-open-card-text">
          <span className="mobile-quick-card-title">{s.open}</span>
          <span className="mobile-quick-card-sub">{s.openSub}</span>
        </span>
        <IconChevronRight size={18} className="mobile-chevron" />
      </button>
      <button type="button" className="mobile-open-card" onClick={() => openOffice({ action: 'home' })} data-testid="home-library">
        <span className="mobile-quick-folder" aria-hidden="true">
          <IconFolderOpen size={19} />
        </span>
        <span className="mobile-open-card-text">
          <span className="mobile-quick-card-title">{s.library}</span>
          <span className="mobile-quick-card-sub">{s.librarySub}</span>
        </span>
        <IconChevronRight size={18} className="mobile-chevron" />
      </button>
    </section>
  )
}

/** Full-screen office overlay. Mounted once at the app root; created on first use, then kept alive. */
export function OfficeOverlay() {
  const s = useOfficeText()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [ready, setReady] = useState(false)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const pending = useRef<OfficeAction[]>([])

  const send = useCallback((a: OfficeAction) => {
    frame.current?.contentWindow?.postMessage({ type: 'ae-office', ...a }, '*')
  }, [])

  // "Open in AllEditor": office files another app handed over (queued by src-tauri/src/office.rs)
  useEffect(() => {
    const t = tauri()
    if (!t?.core || !t.event) return
    let unlisten: (() => void) | undefined
    const take = async () => {
      const list = await t.core!.invoke<Array<{ name: string; data: string }>>('ae_take_office_intents').catch(() => [])
      for (const f of list) openOffice({ action: 'import', name: f.name, data: f.data })
    }
    void take()
    void t.event.listen('ae-office-intent', () => void take()).then((u) => (unlisten = u))
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const a = (e as CustomEvent<OfficeAction>).detail
      setMounted(true)
      setVisible(true)
      if (ready) send(a)
      else pending.current.push(a)
    }
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const type = (e.data as { type?: string } | null)?.type
      if (type === 'ae-office-ready') {
        setReady(true)
        for (const a of pending.current.splice(0)) send(a)
      } else if (type === 'ae-office-close' || type === 'ae-open-hwp' || type === 'ae-new-hwp') {
        setVisible(false)
      }
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen)
      window.removeEventListener('message', onMessage)
    }
  }, [ready, send])

  if (!mounted) return null
  return (
    <div
      data-testid="office-overlay"
      aria-hidden={!visible}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'var(--mobile-bg, #f2f2f7)',
        display: visible ? 'block' : 'none',
      }}
    >
      {!ready && (
        <p style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center', opacity: 0.6 }}>{s.loading}</p>
      )}
      <iframe
        ref={frame}
        title={s.section}
        src={officeBaseUrl() + 'index.html?embed=1'}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  )
}

/** Credit line (user-mandated, small text, Korean first). Apache-2.0 attribution of 이음오피스 and GenOffice. */
export const CREDIT_TEXT =
  'AllEditor (iOS / iPadOS) — Developed by JaiSung NOH MD, 2026. This app is built on the open source of 이음오피스 (IeumOffice) by 박준일 (Jun-il Park), which is itself based on GenOffice by Genspark AI / Mainfunc, Inc. (Apache License 2.0)'

export function CreditFooter() {
  return (
    <footer
      data-testid="home-credit"
      style={{ margin: '28px 4px 12px', fontSize: 11, lineHeight: 1.5, opacity: 0.6, textAlign: 'center' }}
    >
      {CREDIT_TEXT}
    </footer>
  )
}

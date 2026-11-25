// AllEditor: Word / PowerPoint / Excel / PDF (+ Pages·Keynote·Numbers import, PDF tools, printing).
// The office suite is a separate web app bundled with the iOS app and served by the Rust side on the
// `office://` scheme (src-tauri/src/office.rs). It runs in a full-screen overlay iframe that stays alive
// while hidden, so open office tabs survive a trip back to the 이음오피스 home.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMobileLocale } from '../i18n'
import { IconChevronRight, IconFolderOpen } from './MobileIcons'

type OfficeApp = 'docs' | 'slides' | 'sheets'
type OfficeAction = { action: 'home' } | { action: 'new'; app: OfficeApp }

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

/** Home-screen section: new Word / PowerPoint / Excel, open any office file (incl. PDF and iWork). */
export function OfficeHomeSection() {
  const s = useOfficeText()
  const cards: Array<{ app: OfficeApp; title: string; sub: string; label: string; color: string }> = [
    { app: 'docs', title: s.word, sub: '.docx', label: 'W', color: '#2b6cd4' },
    { app: 'slides', title: s.ppt, sub: '.pptx', label: 'P', color: '#d24726' },
    { app: 'sheets', title: s.excel, sub: '.xlsx', label: 'X', color: '#1e7145' },
  ]
  return (
    <section className="mobile-home-cta-group" aria-label={s.section} data-testid="home-office-section">
      <h2 className="mobile-section-heading">{s.section}</h2>
      <div className="mobile-home-create-grid">
        {cards.map((c) => (
          <button
            key={c.app}
            type="button"
            className="mobile-quick-card"
            onClick={() => openOffice({ action: 'new', app: c.app })}
            data-testid={`home-office-new-${c.app}`}
          >
            <Badge label={c.label} color={c.color} />
            <div className="mobile-quick-card-text">
              <span className="mobile-quick-card-title">{c.title}</span>
              <span className="mobile-quick-card-sub">{c.sub}</span>
            </div>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="mobile-open-card"
        onClick={() => openOffice({ action: 'home' })}
        data-testid="home-office-open"
      >
        <span className="mobile-quick-folder" aria-hidden="true">
          <IconFolderOpen size={19} />
        </span>
        <span className="mobile-open-card-text">
          <span className="mobile-quick-card-title">{s.open}</span>
          <span className="mobile-quick-card-sub">{s.openSub}</span>
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
  const pending = useRef<OfficeAction | null>(null)

  const send = useCallback((a: OfficeAction) => {
    frame.current?.contentWindow?.postMessage({ type: 'ae-office', ...a }, '*')
  }, [])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const a = (e as CustomEvent<OfficeAction>).detail
      setMounted(true)
      setVisible(true)
      if (ready) send(a)
      else pending.current = a
    }
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const type = (e.data as { type?: string } | null)?.type
      if (type === 'ae-office-ready') {
        setReady(true)
        if (pending.current) {
          send(pending.current)
          pending.current = null
        }
      } else if (type === 'ae-office-close') {
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

// AllEditor: Word / PowerPoint / Excel / PDF (+ Pages·Keynote·Numbers import, PDF tools, printing).
// The office suite is a separate web app bundled with the iOS app and served by the Rust side on the
// `office://` scheme (src-tauri/src/office.rs). Its home (shim/home/home.ts) is the app's home: the office
// iframe fills the screen and stays alive while another screen (settings, the text editor of an opened
// .md/.txt file) is shown.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMobileLocale } from '../i18n'

type OfficeApp = 'hwp' | 'docs' | 'slides' | 'sheets'
type OfficeAction =
  | { action: 'home' }
  | { action: 'new'; app: OfficeApp }
  | { action: 'open'; path: string } // a document of the Documents folder
  | { action: 'import'; name: string; data: string } // file handed over by another app (base64)

interface TauriGlobal {
  core?: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> }
  event?: { listen: (name: string, cb: () => void) => Promise<() => void> }
}
interface TauriInternals {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
  transformCallback: (cb: (payload: unknown) => void, once?: boolean) => number
}
/**
 * The Tauri bridge the same way 이음오피스's transport finds it (packages/mobile-bridge/src/transport.ts):
 * `window.__TAURI__` when the global API is injected, else `__TAURI_INTERNALS__` (always present in a Tauri webview).
 */
export const tauri = (): TauriGlobal | undefined => {
  const g = window as unknown as { __TAURI__?: TauriGlobal; __TAURI_INTERNALS__?: TauriInternals }
  const internals = g.__TAURI_INTERNALS__
  const invoke = g.__TAURI__?.core?.invoke ?? internals?.invoke.bind(internals)
  if (!invoke) return undefined
  const listen =
    g.__TAURI__?.event?.listen ??
    (internals
      ? (name: string, cb: () => void) =>
          internals
            .invoke<number>('plugin:event|listen', {
              event: name,
              target: { kind: 'Any' },
              handler: internals.transformCallback(() => cb()),
            })
            .then((eventId) => () => void internals.invoke('plugin:event|unlisten', { event: name, eventId }).catch(() => {}))
      : undefined)
  return { core: { invoke }, event: listen ? { listen } : undefined }
}

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
  ko: { section: 'AllEditor', loading: '여는 중…' },
  en: { section: 'AllEditor', loading: 'Opening…' },
} as const

/**
 * The app's home: the office suite, full screen. Mounted once at the app root and kept alive; `active` is false
 * while another screen of the app is shown. An office action (new / open / a file handed over by another app)
 * asks the app to come back to it (`onShow`).
 */
export function OfficeOverlay({ active, onShow }: { readonly active: boolean; readonly onShow?: () => void }) {
  const { lang } = useMobileLocale()
  const s = lang === 'ko' ? TEXT.ko : TEXT.en
  const [ready, setReady] = useState(false)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const pending = useRef<OfficeAction[]>([])
  const showRef = useRef(onShow)
  showRef.current = onShow

  // the on-screen keyboard: the suite fills the space above it (the web view itself never scrolls, see
  // AllEditorDialogs.swift aeLockWebViewScroll), so the tab bar and the ribbon stay on screen while typing
  const [viewH, setViewH] = useState<number | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const fit = () => {
      setViewH(Math.round(vv.height) < window.innerHeight - 1 ? Math.round(vv.height) : null)
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0)
    }
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    window.addEventListener('scroll', fit)
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); window.removeEventListener('scroll', fit) }
  }, [])

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
      showRef.current?.()
      if (ready) send(a)
      else pending.current.push(a)
    }
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      if ((e.data as { type?: string } | null)?.type === 'ae-office-ready') {
        setReady(true)
        for (const a of pending.current.splice(0)) send(a)
      }
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen)
      window.removeEventListener('message', onMessage)
    }
  }, [ready, send])

  return (
    <div
      data-testid="office-overlay"
      aria-hidden={!active}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: viewH ?? '100%',
        zIndex: 1000,
        background: 'var(--mobile-bg, #f2f2f7)',
        display: active ? 'block' : 'none',
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

// iPhone layer: iPad (and desktop preview) keep the Mac UI untouched.
export const isPhone = () => Math.min(screen.width, screen.height) < 600

const CSS = `
html[data-device='phone'] { -webkit-text-size-adjust: 100%; }
/* AI panel: hidden by default (see shell-ipc), full-screen sheet when opened */
html[data-device='phone'] .ai-dock:not(.collapsed),
html[data-device='phone'] .copilot:not(.collapsed) {
  position: fixed !important; inset: 0 !important; width: 100% !important; max-width: none !important;
  z-index: 2000 !important; background: var(--chrome-bg, var(--surface, #fff));
}
html[data-device='phone'] .ai-panel-resizer { display: none !important; }
/* one scrollable tab row instead of wrapping into a tall block */
html[data-device='phone'] .ribbon-tabs {
  flex-wrap: nowrap !important; overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
  padding-left: 8px !important; padding-right: 8px !important; -webkit-overflow-scrolling: touch;
}
html[data-device='phone'] .ribbon-tabs::-webkit-scrollbar { display: none; }
html[data-device='phone'] .ribbon-tabs > *, html[data-device='phone'] .ribbon-tab,
html[data-device='phone'] .ribbon-tab-file, html[data-device='phone'] .file-tab-wrap button { flex-shrink: 0; white-space: nowrap; word-break: keep-all; }
html[data-device='phone'] .ribbon-file { display: none; }
/* slide thumbnails: narrow rail */
html[data-device='phone'] .slide-list { width: 76px !important; padding: 6px !important; }
html[data-device='phone'] .thumb-resizer { display: none !important; }
html[data-device='phone'] .pdf-thumbs { width: 84px !important; }
/* bigger touch targets in the ribbon / tab strip */
html[data-device='phone'] .ribbon-tab, html[data-device='phone'] .ribbon-tabs button { min-height: 40px; padding-left: 12px; padding-right: 12px; }
html[data-device='phone'] .ribbon-body { -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; }
html[data-device='phone'] body { overscroll-behavior: none; }
`

export function applyPhoneLayer() {
  if (!isPhone()) return
  document.documentElement.dataset.device = 'phone'
  const add = () => {
    const s = document.createElement('style'); s.id = 'ae-phone'; s.textContent = CSS
    document.head.appendChild(s)
  }
  if (document.head) add(); else addEventListener('DOMContentLoaded', add)
}

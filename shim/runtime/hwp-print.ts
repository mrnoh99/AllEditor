// 한글's print preview as the same centred "인쇄" dialog the other editors use (the markup is reshaped in
// scripts/build-web.mjs: a backdrop, a title, the buttons at the bottom; this is its look).
const CSS = `
.ae-pp-backdrop{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:24px}
.ae-pp-backdrop>.hwp-preview{position:relative;inset:auto;z-index:auto;width:min(1500px,100%);height:min(980px,100%);border-radius:16px;overflow:hidden;
  box-shadow:0 18px 60px rgba(0,0,0,.35);background:var(--surface);
  grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto minmax(0,1fr) auto auto}
.ae-pp-head{grid-column:1/-1;padding:16px 24px 10px;font-size:17px;font-weight:700;border-bottom:1px solid var(--border)}
.ae-pp-backdrop .hwp-preview-bar{grid-column:1;border-bottom:1px solid var(--border);background:var(--surface)}
.ae-pp-backdrop .hwp-preview-viewport{grid-column:1;background:var(--canvas)}
.ae-pp-backdrop .hwp-preview-layout{grid-column:2;grid-row:2/5}
.ae-pp-backdrop .hwp-preview-status{grid-column:1}
.ae-pp-foot{grid-column:1/-1;display:flex;align-items:center;gap:8px;padding:12px 24px;border-top:1px solid var(--border);background:var(--surface)}
.ae-pp-foot .ae-pp-gap{flex:1}
.ae-pp-foot .hwp-preview-button{height:36px;padding:0 16px;border-radius:18px}
`
export function installHwpPrintDialog() {
  const add = () => { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s) }
  if (document.head) add(); else addEventListener('DOMContentLoaded', add)
}

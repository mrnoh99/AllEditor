// A PDF used as a picture (Keynote keeps vector images as PDF in Data/) drawn to a PNG with PDFium, the engine the
// editors already ship (slides/wasm/pdfium.wasm). First page, transparent background, long side up to 2000 px.
let mod: Promise<any> | null = null

function pdfium(): Promise<any> {
  if (!mod) mod = (async () => {
    const { init } = (await import('@embedpdf/pdfium')) as unknown as { init(o: object): Promise<any> }
    const f: typeof fetch = (globalThis as any).__realFetch ?? fetch
    const url = new URL('slides/wasm/pdfium.wasm', location.href).href
    const r = await f(url)
    if (!r.ok) throw new Error('pdfium.wasm ' + r.status)
    // locateFile: the loader asks for the file's address even when it is given the bytes
    const wrapped = await init({ wasmBinary: await r.arrayBuffer(), locateFile: () => url, thisProgram: 'alleditor' })
    const m = wrapped.pdfium ?? wrapped
    m._PDFiumExt_Init()
    return m
  })()
  mod.catch(() => { mod = null })
  return mod
}

export async function pdfToPng(pdf: Uint8Array, maxSide = 2000): Promise<string | null> {
  try {
    const m = await pdfium()
    const ptr = m._malloc(pdf.length)
    if (!ptr) return null
    try {
      m.HEAPU8.set(pdf, ptr)
      const doc = m._FPDF_LoadMemDocument(ptr, pdf.length, 0)
      if (!doc) return null
      try {
        const page = m._FPDF_LoadPage(doc, 0)
        if (!page) return null
        try {
          const w = m._FPDF_GetPageWidthF(page), h = m._FPDF_GetPageHeightF(page)
          const scale = Math.min(4, maxSide / Math.max(w, h, 1))
          const pw = Math.max(1, Math.round(w * scale)), ph = Math.max(1, Math.round(h * scale))
          const bmp = m._FPDFBitmap_Create(pw, ph, 1) // with alpha: the picture keeps its transparent parts
          if (!bmp) return null
          try {
            m._FPDFBitmap_FillRect(bmp, 0, 0, pw, ph, 0x00000000)
            m._FPDF_RenderPageBitmap(bmp, page, 0, 0, pw, ph, 0, 0x01 | 0x10) // annotations, LCD-free text
            const stride = m._FPDFBitmap_GetStride(bmp), buf = m._FPDFBitmap_GetBuffer(bmp)
            const src = m.HEAPU8.subarray(buf, buf + ph * stride)
            const c = document.createElement('canvas'); c.width = pw; c.height = ph
            const ctx = c.getContext('2d')!, img = ctx.createImageData(pw, ph), d = img.data
            for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
              const s = y * stride + x * 4, t = (y * pw + x) * 4
              d[t] = src[s + 2]; d[t + 1] = src[s + 1]; d[t + 2] = src[s]; d[t + 3] = src[s + 3]
            }
            ctx.putImageData(img, 0, 0)
            return c.toDataURL('image/png')
          } finally { m._FPDFBitmap_Destroy(bmp) }
        } finally { m._FPDF_ClosePage(page) }
      } finally { m._FPDF_CloseDocument(doc) }
    } finally { m._free(ptr) }
  } catch (e) { console.warn('[keyx pdf image]', e); return null }
}

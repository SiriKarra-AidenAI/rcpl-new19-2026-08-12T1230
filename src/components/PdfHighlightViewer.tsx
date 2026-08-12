// Renders a real PDF page (via pdf.js) with a highlight rectangle over wherever an extracted
// field's value actually appears on the page — the genuine replacement for the synthetic
// "highlighted row" that used to stand in for this in IntakeReview's Source modal (see
// docSource.ts's FOCUS_ROW_BY_FIELD, which only ever highlighted a mock table).
import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PdfMatch } from '../lib/pdfLocate'
import './PdfHighlightViewer.css'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export function PdfHighlightViewer({ url, matches, maxWidth = 640 }: { url: string; matches: PdfMatch[]; maxWidth?: number }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  // CSS pixel size the canvas is DISPLAYED at — the overlay boxes are positioned against this,
  // never against the canvas's raw backing-store pixel size, so a HiDPI render (buffer scaled
  // by devicePixelRatio for sharpness) can never drift out of sync with the highlight boxes.
  const [rendered, setRendered] = useState<{ width: number; height: number } | null>(null)
  const [error, setError] = useState(false)
  // Measured from the actual containing element rather than assumed, so the canvas always
  // renders at its true displayed size — no CSS max-width/height:auto rescale that the overlay
  // math wouldn't know about.
  const [cssWidth, setCssWidth] = useState(maxWidth)

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const measure = () => setCssWidth(Math.max(200, Math.min(maxWidth, el.clientWidth || maxWidth)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxWidth])

  // Land on whichever page actually has a match rather than always page 1 — a highlight the
  // user has to go hunting for pages to find isn't much better than no highlight at all.
  useEffect(() => { setPageIndex(matches[0]?.page ?? 0) }, [matches])

  useEffect(() => {
    let cancelled = false
    setError(false)
    pdfjs.getDocument(url).promise
      .then(async (pdf) => {
        if (cancelled) return
        setPageCount(pdf.numPages)
        const page = await pdf.getPage(pageIndex + 1)
        const base = page.getViewport({ scale: 1 })
        const scale = cssWidth / base.width
        const dpr = window.devicePixelRatio || 1
        const cssHeight = base.height * scale
        const viewport = page.getViewport({ scale: scale * dpr })
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${cssWidth}px`
        canvas.style.height = `${cssHeight}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await page.render({ canvasContext: ctx, viewport }).promise
        if (!cancelled) setRendered({ width: cssWidth, height: cssHeight })
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [url, pageIndex, cssWidth])

  const pageMatches = matches.filter((m) => m.page === pageIndex)

  if (error) return <p className="muted-note">Couldn't render the original document.</p>

  return (
    <div className="pdf-hl-wrap" ref={outerRef}>
      <div className="pdf-hl-canvas-wrap" style={rendered ? { width: rendered.width, height: rendered.height } : undefined}>
        <canvas ref={canvasRef} />
        {rendered && pageMatches.map((m, i) => (
          <div
            key={i}
            className="pdf-hl-box"
            style={{
              left: m.x * rendered.width,
              top: m.y * rendered.height,
              width: m.width * rendered.width,
              height: m.height * rendered.height,
            }}
          />
        ))}
      </div>
      {pageCount > 1 && (
        <div className="pdf-hl-pager">
          <button className="btn ghost sm" disabled={pageIndex <= 0} onClick={() => setPageIndex((p) => p - 1)}>‹</button>
          <span className="muted-note" style={{ margin: 0 }}>Page {pageIndex + 1} of {pageCount}</span>
          <button className="btn ghost sm" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => p + 1)}>›</button>
        </div>
      )}
    </div>
  )
}

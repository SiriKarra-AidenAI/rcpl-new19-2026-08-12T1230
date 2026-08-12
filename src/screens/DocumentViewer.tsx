// Full-page "View full document" destination — opened in a new tab from IntakeReview's Source
// modal so the same genuine highlight (see PdfHighlightViewer, backend/email_service/pdf_locate.py)
// carries over instead of dropping back to a blind, unannotated copy of the real file.
import './DocumentViewer.css'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PdfHighlightViewer } from '../components/PdfHighlightViewer'
import { locateAllInDoc } from '../lib/pdfLocate'
import type { PdfMatch } from '../lib/pdfLocate'
import { useApp } from '../store'

export function DocumentViewer() {
  const [params] = useSearchParams()
  const itemId = params.get('itemId') ?? ''
  const filename = params.get('filename') ?? ''
  const title = params.get('title') ?? filename
  const queries = params.getAll('q')
  // A document actually uploaded/replaced from Intake Review never reached the backend's
  // attachment store (see store.ts's intakeDocOverrides) — check for its persisted bytes here
  // by filename before assuming the backend fetch below is the only source.
  const localOverride = useApp((s) => s.intakeDocOverrides)[itemId]
  const localDataUrl = localOverride && Object.values(localOverride).find((d) => d.file === filename)?.dataUrl

  const [state, setState] = useState<{ url: string; matches: PdfMatch[] } | 'loading' | 'error'>('loading')

  useEffect(() => {
    setState('loading')
    if (!itemId || !filename) { setState('error'); return }
    if (localDataUrl) { setState({ url: localDataUrl, matches: [] }); return }
    let cancelled = false
    let objectUrl: string | null = null
    ;(async () => {
      try {
        const res = await fetch(`/api/intake/${encodeURIComponent(itemId)}/attachment?filename=${encodeURIComponent(filename)}`)
        if (!res.ok) throw new Error('not found')
        const blob = await res.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        const matches = await locateAllInDoc(itemId, filename, queries)
        if (!cancelled) setState({ url: objectUrl, matches })
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, filename, queries.join(','), localDataUrl])

  return (
    <div className="doc-viewer-page">
      <div className="doc-viewer-head">
        <span className="doc-viewer-title">{title}</span>
        <button className="btn ghost sm" onClick={() => window.close()}>Close</button>
      </div>
      <div className="doc-viewer-body">
        {state === 'loading' && <p className="muted-note">Loading the original document…</p>}
        {state === 'error' && <p className="muted-note">Couldn't load this document — it may not have a real attachment on file.</p>}
        {state !== 'loading' && state !== 'error' && (
          <PdfHighlightViewer url={state.url} matches={state.matches} maxWidth={900} />
        )}
      </div>
    </div>
  )
}

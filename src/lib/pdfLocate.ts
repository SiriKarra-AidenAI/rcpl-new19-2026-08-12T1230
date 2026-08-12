// Client for the backend's real-PDF text-position lookup (see
// backend/email_service/pdf_locate.py) — finds where an extracted field's actual value sits on
// the real uploaded document, so a "Source" highlight can point at the genuine page instead of
// a synthetic mock row.
export interface PdfMatch { page: number; x: number; y: number; width: number; height: number }

export async function locateTextInDoc(itemId: string, filename: string, query: string): Promise<PdfMatch[]> {
  if (!query.trim()) return []
  try {
    const res = await fetch(`/api/intake/${encodeURIComponent(itemId)}/locate-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, query }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data.matches) ? data.matches : []
  } catch {
    return []
  }
}

// One field can map to several highlightable values (e.g. a doc's own View highlights every
// field it backs) — look them all up in parallel and flatten, de-duping identical boxes.
export async function locateAllInDoc(itemId: string, filename: string, queries: string[]): Promise<PdfMatch[]> {
  const unique = [...new Set(queries.filter((q) => q.trim()))]
  const results = await Promise.all(unique.map((q) => locateTextInDoc(itemId, filename, q)))
  const seen = new Set<string>()
  const out: PdfMatch[] = []
  for (const m of results.flat()) {
    const key = `${m.page}:${m.x.toFixed(3)}:${m.y.toFixed(3)}`
    if (!seen.has(key)) { seen.add(key); out.push(m) }
  }
  return out
}

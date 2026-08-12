import './DocumentAuthenticity.css'
import { useEffect, useState } from 'react'
import { Card, Button, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { useApp } from '../store'
import { EXTRACTIONS, applyDocOverrides, mergedFields } from '../mock/intake'
import type { Extraction, RequiredDoc } from '../mock/intake'
import { isBusinessCapacityDoc } from '../lib/documentPolicy'
import { buildPdf, openPdfInNewTab } from '../lib/pdf'

// Same deterministic per-file tamper check Intake Review runs inline — centralized here so
// ASE/ASM has one place to authenticity-check every received document across the whole intake
// queue, instead of opening each lead one at a time.
function scanFor(fileName: string): boolean {
  const h = [...fileName].reduce((a, ch) => a + ch.charCodeAt(0), 0)
  return h % 7 === 0
}

type CheckStatus = 'passed' | 'suspicious' | 'tampered'
// Every check always carries a detail — for a passed check it's what was actually verified
// (not just "nothing to report"), so dropping down any row shows real supporting information.
interface CheckItem {
  key: string; label: string; sub: string; status: CheckStatus
  detail: { page: number; location: string; issue: string; confidence: number }
}
interface Analysis { checks: CheckItem[]; overallScore: number; confidence: number; risk: 'Low' | 'Medium' | 'High' }

// Deterministic per document — same file always analyzes the same way. The base tampered
// signal reuses the list view's scanFor() so the two screens never disagree with each other.
function analyzeDoc(doc: RequiredDoc): Analysis {
  const key = doc.file ?? doc.name
  const seed = [...key].reduce((a, ch) => a + ch.charCodeAt(0), 0)
  const tampered = scanFor(key)
  const fontSus = seed % 5 === 0
  const sigSus = seed % 4 === 0
  const checks: CheckItem[] = [
    {
      key: 'metadata', label: 'Metadata Analysis', sub: 'File creation & modification history', status: 'passed',
      detail: { page: 1, location: 'Document properties', issue: 'Creation and last-modified timestamps are consistent with the claimed upload date — no post-hoc editing tool signature found.', confidence: 96 },
    },
    {
      key: 'text', label: 'Text Layer Analysis', status: tampered ? 'tampered' : 'passed',
      sub: tampered ? 'Edited text detected' : 'No edited text layers found',
      detail: tampered
        ? { page: 1, location: 'GSTIN', issue: 'Text appears to be digitally altered', confidence: 94 }
        : { page: 1, location: 'Full document', issue: 'Every text layer traces back to the original render — no overlaid or re-typed characters detected.', confidence: 95 },
    },
    {
      key: 'font', label: 'Font Consistency', status: fontSus ? 'suspicious' : 'passed',
      sub: fontSus ? 'Different font family detected' : 'Consistent font usage throughout',
      detail: fontSus
        ? { page: 1, location: 'Date of issue', issue: 'Font weight differs from surrounding text', confidence: 68 }
        : { page: 1, location: 'Full document', issue: 'Same font family and weight used end to end, matching the issuing authority\'s known template.', confidence: 92 },
    },
    {
      key: 'qr', label: 'QR Code Verification', sub: 'QR matches issuing database', status: 'passed',
      detail: { page: 1, location: 'QR code', issue: 'Decoded payload matches the issuing authority\'s reference number on file.', confidence: 97 },
    },
    {
      key: 'seal', label: 'Seal Detection', sub: 'Seal detected and verified', status: 'passed',
      detail: { page: 1, location: 'Official seal', issue: 'Seal shape, placement and ink pattern match the issuing authority\'s registered seal.', confidence: 93 },
    },
    {
      key: 'sig', label: 'Signature Analysis', status: sigSus ? 'suspicious' : 'passed',
      sub: sigSus ? 'Possible pasted signature' : 'Signature consistent with issuer records',
      detail: sigSus
        ? { page: 1, location: 'Signature block', issue: 'Signature edges show pixel inconsistency', confidence: 61 }
        : { page: 1, location: 'Signature block', issue: 'Stroke pressure and pixel edges are continuous with the rest of the scan — no cut-and-paste artifacts.', confidence: 90 },
    },
  ]
  const issues = checks.filter((c) => c.status !== 'passed').length
  return {
    checks,
    overallScore: Math.max(35, 100 - issues * 22),
    confidence: Math.max(50, 100 - issues * 10),
    risk: tampered ? 'High' : issues > 0 ? 'Medium' : 'Low',
  }
}

// Field rows for the mock preview panel — real extracted values where the lead's intake has
// them, generic placeholders otherwise (same "prototype stand-in" convention used everywhere
// else this app generates a document preview).
function previewRows(ext: Extraction, doc: RequiredDoc): { k: string; v: string; flag?: 'text' | 'font' }[] {
  const val = (re: RegExp) => mergedFields(ext).find((f) => re.test(f.label) && f.ok)?.value
  const firm = val(/firm|agency/i) ?? ext.source
  const gst = val(/gst/i) ?? '27AAAAA0000A1Z5'
  const town = val(/town/i) ?? '—'
  const state = val(/^state/i) ?? 'Maharashtra'
  if (doc.name.toLowerCase().includes('gst')) {
    // Field-for-field match to the real Form GST REG-06 Registration Certificate (see
    // samples_for_demo/gst_rao_distributors.pdf) — a synthetic preview should read as a
    // complete certificate, not a truncated summary, even with no real file to fall back to.
    return [
      { k: 'GSTIN', v: gst, flag: 'text' },
      { k: 'Legal Name', v: firm.toUpperCase() },
      { k: 'Trade Name, if any', v: firm },
      { k: 'Constitution of Business', v: 'Proprietorship' },
      { k: 'Address of Principal Place of Business', v: `${town}, ${state}` },
      { k: 'Date of Liability', v: ext.receivedAt },
      { k: 'Period of Validity', v: 'From date of liability · To Not Applicable' },
      { k: 'Type of Registration', v: 'Regular' },
      { k: 'Particulars of Approving Authority', v: `State Tax Officer, ${town}` },
      { k: 'Date of issue of Certificate', v: ext.receivedAt, flag: 'font' },
    ]
  }
  return [
    { k: 'Firm / Agency', v: firm },
    { k: 'Town / City', v: town },
    { k: 'State', v: state },
    { k: 'Document', v: doc.name, flag: 'text' },
  ]
}

const STATUS_TONE: Record<CheckStatus, 'good' | 'warn' | 'crit'> = { passed: 'good', suspicious: 'warn', tampered: 'crit' }
const STATUS_LABEL: Record<CheckStatus, string> = { passed: 'Passed', suspicious: 'Suspicious', tampered: 'Tampered' }

function DocumentDetail({ ext, doc: initialDoc, allDocs, onBack }: { ext: Extraction; doc: RequiredDoc; allDocs: RequiredDoc[]; onBack: () => void }) {
  const logAudit = useApp((s) => s.logAudit)
  // Which of this lead's received documents is being checked — defaults to whichever one the
  // queue opened (usually the one that earned the row its flagged/pending badge), but a lead
  // can have several documents and the analyst should be able to switch between them instead of
  // only ever seeing that one.
  const [doc, setDoc] = useState(initialDoc)
  useEffect(() => { setDoc(initialDoc) }, [initialDoc])
  const analysis = analyzeDoc(doc)
  const [tab, setTab] = useState<'all' | 'issues' | 'passed'>('all')
  const [openCheck, setOpenCheck] = useState<string | null>(analysis.checks.find((c) => c.status !== 'passed')?.key ?? null)
  const issues = analysis.checks.filter((c) => c.status !== 'passed')
  const passed = analysis.checks.filter((c) => c.status === 'passed')
  const visibleChecks = tab === 'issues' ? issues : tab === 'passed' ? passed : analysis.checks
  const rows = previewRows(ext, doc)
  const tamperedRow = rows.find((r) => r.flag === 'text' && analysis.checks.find((c) => c.key === 'text')?.status === 'tampered')
  const suspiciousRow = rows.find((r) => r.flag === 'font' && analysis.checks.find((c) => c.key === 'font')?.status === 'suspicious')
  const worst: CheckStatus = analysis.checks.some((c) => c.status === 'tampered') ? 'tampered'
    : analysis.checks.some((c) => c.status === 'suspicious') ? 'suspicious' : 'passed'

  // Loads the REAL attachment for the inline preview panel — a file actually uploaded/replaced
  // from Intake Review (doc.dataUrl, persisted — see store.ts's intakeDocOverrides) first, then
  // the email-captured one on the backend (see backend/email_service/attachment_store.py), and
  // only falls back to the synthetic mock preview below if neither exists for this doc.
  const [realDoc, setRealDoc] = useState<{ url: string; type: string } | null>(null)
  useEffect(() => {
    setRealDoc(null)
    if (doc.dataUrl) { setRealDoc({ url: doc.dataUrl, type: doc.dataUrl.match(/^data:([^;]+)/)?.[1] ?? '' }); return }
    if (!doc.file) return
    let cancelled = false
    let objectUrl: string | null = null
    fetch(`/api/intake/${encodeURIComponent(ext.id)}/attachment?filename=${encodeURIComponent(doc.file)}`)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setRealDoc({ url: objectUrl, type: blob.type })
      })
      .catch(() => { /* fall back to mock preview */ })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [ext.id, doc.file, doc.dataUrl])

  // Same real-file-first preference as the inline preview above, for the "View original" tab.
  const viewOriginal = async () => {
    if (doc.dataUrl) { window.open(doc.dataUrl, '_blank'); return }
    if (doc.file) {
      const win = window.open('', '_blank')
      try {
        const res = await fetch(`/api/intake/${encodeURIComponent(ext.id)}/attachment?filename=${encodeURIComponent(doc.file)}`)
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          if (win) win.location.href = url; else window.open(url, '_blank')
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
          return
        }
      } catch { /* fall through to mock */ }
      win?.close()
    }
    openPdfInNewTab(buildPdf([
      { text: 'RCPL Partner Platform — Document on file', size: 9, gap: 18 },
      { text: doc.name, size: 18, bold: true, gap: 30 },
      { text: ext.source, size: 11, gap: 20 },
      ...rows.map((r) => ({ text: `${r.k}:   ${r.v}`, size: 10.5, gap: 18 })),
      { text: ' ', gap: 16 },
      { text: 'Generated preview PDF — prototype stand-in for the actual scan.', size: 8.5 },
    ]))
  }
  const downloadReport = () => {
    openPdfInNewTab(buildPdf([
      { text: 'RCPL Document Intelligence — Full Report', size: 9, gap: 18 },
      { text: doc.name, size: 18, bold: true, gap: 26 },
      { text: `Overall Score: ${analysis.overallScore}/100   Risk Level: ${analysis.risk}   Confidence: ${analysis.confidence}%`, size: 10.5, gap: 22 },
      ...analysis.checks.flatMap((c) => ([
        { text: `${c.label} — ${STATUS_LABEL[c.status]}`, size: 11, bold: true, gap: 16 } as const,
        { text: c.detail ? `${c.detail.location}: ${c.detail.issue} (confidence ${c.detail.confidence}%)` : c.sub, size: 9.5, gap: 16 } as const,
      ])),
      { text: ' ', gap: 12 },
      { text: 'Generated report — prototype stand-in for the actual scan.', size: 8.5 },
    ]))
    logAudit({ actor: 'Document Intelligence Agent', kind: 'ai', action: `Full report downloaded for ${doc.name}`, entity: ext.source })
  }

  // Ask AI Copilot — scripted, deterministic replies (no live model here), same convention as
  // the rest of this prototype's mock chat threads.
  const summaryBullets = issues.length
    ? issues.map((c) => c.detail ? `${c.label}: ${c.detail.issue} (${c.detail.location}, ${c.detail.confidence}% confidence)` : `${c.label}: ${c.sub}`)
    : ['All six checks passed — no signs of tampering, inconsistent fonts, or seal/signature issues.']
  const [copilotMsgs, setCopilotMsgs] = useState<{ who: 'user' | 'bot'; text: string; bullets?: string[] }[]>(
    issues.length ? [{ who: 'user', text: 'Why do you think this document is tampered?' }, { who: 'bot', text: 'I found several indicators in this document:', bullets: summaryBullets }] : [],
  )
  const [copilotDraft, setCopilotDraft] = useState('')
  const askCopilot = (q: string) => {
    if (!q.trim()) return
    setCopilotMsgs((m) => [...m, { who: 'user', text: q.trim() }, { who: 'bot', text: 'Based on the checks run on this document:', bullets: summaryBullets }])
    setCopilotDraft('')
  }

  return (
    <div>
      <div className="page-head">
        <div className="row-between">
          <Button variant="text" onClick={onBack}>← Back to queue</Button>
        </div>
      </div>

      <div className="da-detail-top">
        <div className="da-detail-file">
          <span className="da-detail-file-ic"><Icon name="documents" size={18} /></span>
          <div>
            <div className="da-detail-file-name">{doc.file ?? doc.name}</div>
            <div className="da-detail-file-meta">{doc.name} · 3 Pages · Uploaded {ext.receivedAt} by {ext.assignedTo ?? ext.source}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center' }}>
          <button className="btn text sm" onClick={viewOriginal}>View original</button>
          <Button onClick={downloadReport}><Icon name="download" size={13} /> Download full report</Button>
        </div>
      </div>

      {allDocs.length > 1 && (
        <div className="da-tabs" style={{ marginBottom: '1rem' }}>
          <span className="muted-note" style={{ margin: '0 0.4rem 0 0', alignSelf: 'center' }}>Check document:</span>
          {allDocs.map((d) => (
            <button key={d.name} className={`da-tab ${d.name === doc.name ? 'active' : ''}`} onClick={() => setDoc(d)}>
              <span className="da-badge-dot" style={{ background: BUCKET_COLOR[bucketFor(d)], marginRight: '0.35rem' }} />
              {d.name}
            </button>
          ))}
        </div>
      )}

      <div className="da-layout">
        <Card title="Document Preview">
          <div className="da-preview-toolbar">
            <span className="muted-note" style={{ margin: 0 }}>Zoom</span>
            <span className="da-preview-zoom">− 100% +</span>
          </div>
          <div className="da-preview-body">
            {realDoc ? (
              <div className="da-real-doc">
                {realDoc.type.startsWith('image/')
                  ? <img src={realDoc.url} alt={doc.name} />
                  // #view=FitH forces the browser's native PDF viewer to fit the page to the
                  // iframe's width — without it, it opens at a small default zoom centered in
                  // a mostly-empty dark viewer background.
                  : <iframe src={`${realDoc.url}#view=FitH`} title={doc.name} />}
              </div>
            ) : (
              <>
                <div className="da-thumbs">
                  {[1, 2, 3].map((n) => <div key={n} className={`da-thumb ${n === 1 ? 'active' : ''}`}>{n}</div>)}
                  <div className="da-thumb add">+</div>
                </div>
                <div className="da-cert">
                  <div className="da-cert-seal">🇮🇳</div>
                  <div className="da-cert-head">Government of India<br />Registration Certificate</div>
                  {rows.map((r) => {
                    const cls = tamperedRow === r ? 'tampered' : suspiciousRow === r ? 'suspicious' : ''
                    return (
                      <div className={`da-cert-row ${cls}`} key={r.k}>
                        <span className="k">{r.k}</span>
                        <span className="v">{r.v}
                          {cls === 'tampered' && <span className="da-badge-dot" style={{ background: 'var(--crit)' }} />}
                          {cls === 'suspicious' && <span className="da-badge-dot" style={{ background: 'var(--warn)' }} />}
                        </span>
                      </div>
                    )
                  })}
                  <div className="da-legend">
                    <span><span className="da-badge-dot" style={{ background: 'var(--crit)' }} /> Tampered / Edited</span>
                    <span><span className="da-badge-dot" style={{ background: 'var(--warn)' }} /> Suspicious</span>
                    <span><span className="da-badge-dot" style={{ background: 'var(--good)' }} /> Verified</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card title="AI Analysis Summary">
          <div className="da-stat-tiles">
            <div className="da-stat-tile"><div className="da-stat-k">Overall Score</div><div className="da-stat-v">{analysis.overallScore}/100</div></div>
            <div className="da-stat-tile"><div className="da-stat-k">Risk Level</div><Pill tone={STATUS_TONE[worst]}>{analysis.risk}</Pill></div>
            <div className="da-stat-tile"><div className="da-stat-k">Confidence</div><div className="da-stat-v">{analysis.confidence}%</div><div className="da-stat-cap">{analysis.confidence >= 80 ? 'High Confidence' : analysis.confidence >= 60 ? 'Medium Confidence' : 'Low Confidence'}</div></div>
            <div className="da-stat-tile"><div className="da-stat-k">Checks Performed</div><div className="da-stat-v">{analysis.checks.length}/{analysis.checks.length}</div><div className="da-stat-cap">Completed</div></div>
          </div>

          <div className="da-tabs">
            <button className={`da-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>All Checks ({analysis.checks.length})</button>
            <button className={`da-tab ${tab === 'issues' ? 'active' : ''}`} onClick={() => setTab('issues')}>Issues ({issues.length})</button>
            <button className={`da-tab ${tab === 'passed' ? 'active' : ''}`} onClick={() => setTab('passed')}>Passed ({passed.length})</button>
          </div>

          {visibleChecks.map((c) => {
            const open = openCheck === c.key
            return (
              <div className="da-check" key={c.key}>
                <div className="da-check-head" onClick={() => setOpenCheck(open ? null : c.key)}>
                  <span className={`da-check-ic ${c.status}`}><Icon name={c.status === 'passed' ? 'check' : c.status === 'suspicious' ? 'alert' : 'close'} size={15} /></span>
                  <div style={{ flex: 1 }}>
                    <div className="da-check-label">{c.label}</div>
                    <div className="da-check-sub">{c.sub}</div>
                  </div>
                  <Pill tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Pill>
                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
                </div>
                {open && (
                  <div className="da-check-body">
                    <div className="da-check-grid">
                      <div><div className="k">Page</div><div className="v">{c.detail.page}</div></div>
                      <div><div className="k">Location</div><div className="v">{c.detail.location}</div></div>
                      <div><div className="k">{c.status === 'passed' ? 'Finding' : 'Issue'}</div><div className="v">{c.detail.issue}</div></div>
                      <div><div className="k">Confidence</div><div className="v">{c.detail.confidence}%</div></div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </Card>

        <div className="stack">
          <Card title="AI Verdict">
            <div className="da-verdict">
              <div className={`da-verdict-ic ${worst === 'passed' ? 'good' : worst}`}>
                <Icon name={worst === 'passed' ? 'check' : 'alert'} size={26} />
              </div>
              <div className="da-verdict-title">{worst === 'tampered' ? 'Possible Tampering Detected' : worst === 'suspicious' ? 'Minor Inconsistencies Found' : 'Document Appears Authentic'}</div>
              <p className="da-verdict-body">
                {worst === 'tampered'
                  ? 'This document has signs of digital alteration in certain areas. Please review the details.'
                  : worst === 'suspicious'
                    ? 'Nothing conclusive, but a few checks came back suspicious rather than a clean pass.'
                    : 'All checks passed — no signs of tampering, inconsistent fonts, or seal/signature issues.'}
              </p>
              <div className="da-verdict-rec">
                <strong>Recommendation:</strong> {worst === 'passed' ? 'No further action needed.' : 'Review & verify with original source.'}
              </div>
            </div>
          </Card>

          <Card title="Ask AI Copilot">
            <div style={{ marginBottom: '0.7rem' }}>
              {copilotMsgs.map((m, i) => (
                <div className={`da-copilot-msg ${m.who}`} key={i}>
                  <div className="da-copilot-bubble">
                    {m.text}
                    {m.bullets && <ul>{m.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
                  </div>
                </div>
              ))}
              {copilotMsgs.length === 0 && <p className="muted-note" style={{ marginTop: 0 }}>Ask about any of the checks above.</p>}
            </div>
            <div className="da-chips">
              <button className="da-chip" onClick={() => askCopilot(`Explain the ${issues[0]?.label ?? 'Text Layer Analysis'} issue`)}>Explain the issue</button>
              <button className="da-chip" onClick={() => askCopilot('Is the QR code valid?')}>Is the QR code valid?</button>
            </div>
            <form className="da-copilot-input" onSubmit={(e) => { e.preventDefault(); askCopilot(copilotDraft) }}>
              <input className="input" value={copilotDraft} onChange={(e) => setCopilotDraft(e.target.value)} placeholder="Ask a follow-up question…" />
              <Button size="sm" type="submit"><Icon name="send" size={13} /></Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  )
}

// Same deterministic bucketing scanFor() already uses for tampered — extended with a
// "pending" bucket (not yet reviewed) purely for the dashboard's 3-way split. A document's
// bucket never changes between screens since it's derived from the same file identity.
type DocBucket = 'verified' | 'flagged' | 'pending'
function bucketFor(doc: RequiredDoc): DocBucket {
  const key = doc.file ?? doc.name
  const h = [...key].reduce((a, ch) => a + ch.charCodeAt(0), 0)
  if (h % 7 === 0) return 'flagged'
  if (h % 9 === 0) return 'pending'
  return 'verified'
}
const BUCKET_LABEL: Record<DocBucket, string> = { verified: 'Verified', flagged: 'Flagged', pending: 'Pending' }
const BUCKET_TONE: Record<DocBucket, 'good' | 'crit' | 'warn'> = { verified: 'good', flagged: 'crit', pending: 'warn' }
const BUCKET_COLOR: Record<DocBucket, string> = { verified: 'var(--good)', flagged: 'var(--crit)', pending: 'var(--warn)' }

// Deterministic 7-point series ending exactly at `end` — decorative trend history, not a
// claim of real historical data (same convention Analytics.tsx's trendToward() uses).
function trendToward(end: number, n = 7): number[] {
  const start = Math.max(0, end * 0.5)
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    const base = start + (end - start) * t
    const wiggle = Math.sin(i * 2.1 + end) * (base * 0.12)
    return Math.max(0, Math.round(base + wiggle))
  })
}

function TrendChart({ series, labels }: { series: { label: string; color: string; data: number[] }[]; labels: string[] }) {
  const W = 320, H = 130, PAD = 8
  const max = Math.max(1, ...series.flatMap((s) => s.data))
  const n = labels.length
  const x = (i: number) => PAD + (i / (n - 1)) * (W - PAD * 2)
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2 - 16)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={150}>
        {series.map((s) => (
          <g key={s.label}>
            <polyline fill="none" stroke={s.color} strokeWidth={2}
              points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            {s.data.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color} />)}
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.64rem', color: 'var(--ink-mute)', padding: '0 4px' }}>
        {labels.map((l) => <span key={l}>{l}</span>)}
      </div>
    </div>
  )
}

const PAGE_SIZE = 7

export function DocumentAuthenticity() {
  const logAudit = useApp((s) => s.logAudit)
  const intakeDocOverrides = useApp((s) => s.intakeDocOverrides)
  // A document actually uploaded/replaced from Intake Review survives EXTRACTIONS resetting to
  // its base seed on every full page reload (see store.ts's intakeDocOverrides) — re-applied
  // here too, since this screen can be opened directly without Intake Review ever having run.
  Object.values(EXTRACTIONS).forEach((e) => applyDocOverrides(e, intakeDocOverrides[e.id]))
  const [detail, setDetail] = useState<{ ext: Extraction; doc: RequiredDoc } | null>(null)
  const [tab, setTab] = useState<'all' | 'verified' | 'flagged' | 'pending'>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  // Newest first — same convention as IntakeInbox.tsx's recency(), so a freshly-arrived lead
  // lands on page 1 here too, instead of behind however many mock leads happen to precede it
  // in EXTRACTIONS' (insertion-order) key list until you search for it specifically. Matches the
  // LEADING digits only (not `$`-anchored) — an Excel bulk import's ids carry an extra `-${idx}`
  // suffix, which an end-anchored regex never matched.
  const recency = (e: Extraction): number => {
    const m = e.id.match(/^intake-(\d+)/)
    if (m) return +m[1]
    const t = Date.parse(e.receivedFull ?? '')
    return Number.isNaN(t) ? 0 : t
  }

  // Every intake item with at least one received document — across the whole Intake Inbox,
  // not just whichever lead you happened to open.
  const items = Object.values(EXTRACTIONS)
    .map((ext) => ({
      ext,
      docs: (ext.documents ?? []).filter((d) => d.received && !isBusinessCapacityDoc(d.name)),
      excluded: (ext.documents ?? []).filter((d) => d.received && isBusinessCapacityDoc(d.name)),
    }))
    .filter((row) => row.docs.length > 0 || row.excluded.length > 0)
    .sort((a, b) => recency(b.ext) - recency(a.ext))

  const allDocs = items.flatMap(({ ext, docs, excluded }) => [...docs, ...excluded].map((doc) => ({ ext, doc })))
  const counts: Record<DocBucket, number> = { verified: 0, flagged: 0, pending: 0 }
  allDocs.forEach(({ doc }) => counts[bucketFor(doc)]++)
  const total = allDocs.length

  const leadStatus = (row: typeof items[number]): DocBucket => {
    const docs = [...row.docs, ...row.excluded]
    if (docs.some((d) => bucketFor(d) === 'flagged')) return 'flagged'
    if (docs.some((d) => bucketFor(d) === 'pending')) return 'pending'
    return 'verified'
  }

  const typeCounts = new Map<string, number>()
  allDocs.forEach(({ doc }) => typeCounts.set(doc.name, (typeCounts.get(doc.name) ?? 0) + 1))
  const topTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

  const flaggedDocs = allDocs
    .filter(({ doc }) => bucketFor(doc) === 'flagged')
    .map(({ ext, doc }) => {
      const failing = analyzeDoc(doc).checks.find((c) => c.status !== 'passed')
      return { ext, doc, tag: failing?.label.replace(' Analysis', '').replace(' Verification', '').replace(' Detection', '') ?? 'Flagged' }
    })
    .slice(0, 4)

  const trendLabels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  })

  const filteredItems = items
    .filter((row) => tab === 'all' || leadStatus(row) === tab)
    .filter((row) => {
      if (!query.trim()) return true
      const q = query.trim().toLowerCase()
      return row.ext.source.toLowerCase().includes(q) || [...row.docs, ...row.excluded].some((d) => d.name.toLowerCase().includes(q))
    })
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
  const pageItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const openDoc = (ext: Extraction, doc: RequiredDoc) => {
    logAudit({ actor: 'Document Intelligence Agent', kind: 'ai', action: `Opened analysis for ${doc.name}`, entity: ext.source })
    setDetail({ ext, doc })
  }

  if (detail) {
    const row = items.find((r) => r.ext.id === detail.ext.id)
    const docsForRow = row ? [...row.docs, ...row.excluded] : [detail.doc]
    return <DocumentDetail ext={detail.ext} doc={detail.doc} allDocs={docsForRow} onBack={() => setDetail(null)} />
  }

  return (
    <div>
      <div className="page-head">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '0.8rem' }}>
            <span className="ic-icon" style={{ width: 44, height: 44 }}><Icon name="shield" size={20} /></span>
            <div>
              <h1 style={{ margin: 0 }}>Document Authenticity <span className="page-info-ic" title="AI-powered authenticity and tamper checks across all documents received in the Intake Inbox."><Icon name="help" size={13} /></span></h1>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className={`da-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => { setTab('all'); setPage(1) }}><Icon name="check" size={12} /> Auto-clear</button>
            <button className={`da-tab ${tab === 'flagged' ? 'active' : ''}`} onClick={() => { setTab('flagged'); setPage(1) }}><Icon name="flag" size={12} /> Flagged</button>
          </div>
        </div>
      </div>

      <div className="da-stat-tiles" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: '1.1rem' }}>
        <div className="da-stat-tile"><div className="da-stat-k">Leads with Documents</div><div className="da-stat-v">{items.length}</div></div>
        <div className="da-stat-tile"><div className="da-stat-k">Documents Received</div><div className="da-stat-v">{total}</div></div>
        <div className="da-stat-tile"><div className="da-stat-k">Verified (All Good)</div><div className="da-stat-v" style={{ color: 'var(--good-text)' }}>{counts.verified}</div><div className="da-stat-cap">{total ? Math.round((counts.verified / total) * 100) : 0}% of total</div></div>
        <div className="da-stat-tile"><div className="da-stat-k">Flagged (Possible Issues)</div><div className="da-stat-v" style={{ color: 'var(--crit-text)' }}>{counts.flagged}</div><div className="da-stat-cap">{total ? Math.round((counts.flagged / total) * 100) : 0}% of total</div></div>
        <div className="da-stat-tile"><div className="da-stat-k">Pending Review</div><div className="da-stat-v" style={{ color: 'var(--warn-text)' }}>{counts.pending}</div><div className="da-stat-cap">{total ? Math.round((counts.pending / total) * 100) : 0}% of total</div></div>
      </div>

      <div className="an2-row3" style={{ alignItems: 'start' }}>
        <Card title="Leads &amp; Documents">
          <div className="da-toolbar">
            <div className="da-tabs">
              {(['all', 'verified', 'flagged', 'pending'] as const).map((t) => (
                <button key={t} className={`da-tab ${tab === t ? 'active' : ''}`} onClick={() => { setTab(t); setPage(1) }}>
                  {t === 'all' ? `All ${items.length}` : `${BUCKET_LABEL[t as DocBucket]} ${items.filter((r) => leadStatus(r) === t).length}`}
                </button>
              ))}
            </div>
            <div className="da-search">
              <Icon name="search" size={14} />
              <input placeholder="Search by email, lead, or document…" value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1) }} />
            </div>
          </div>

          {pageItems.length === 0 ? (
            <p className="muted-note">No leads match this filter.</p>
          ) : pageItems.map((row) => {
            const docCount = row.docs.length + row.excluded.length
            const status = leadStatus(row)
            // Open whichever document actually earned the row's status badge — a lead badged
            // "Flagged" because doc #3 is tampered shouldn't land on doc #1's clean analysis.
            const allDocs = [...row.docs, ...row.excluded]
            const priorityDoc = allDocs.find((d) => bucketFor(d) === 'flagged') ?? allDocs.find((d) => bucketFor(d) === 'pending')
            const firstDoc = priorityDoc ?? allDocs[0]
            return (
              <button key={row.ext.id} className="da-lead-row" onClick={() => firstDoc && openDoc(row.ext, firstDoc)}>
                <span className="da-lead-avatar">{row.ext.source.slice(0, 2).toUpperCase()}</span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div className="da-lead-name">{row.ext.source}</div>
                  <div className="da-lead-meta">{docCount} document{docCount === 1 ? '' : 's'} · {row.ext.receivedAt}</div>
                </span>
                <Pill tone={BUCKET_TONE[status]} dot>{BUCKET_LABEL[status]}</Pill>
                <Icon name="chevronRight" size={14} />
              </button>
            )
          })}

          {filteredItems.length > 0 && (
            <div className="row-between" style={{ marginTop: '0.8rem' }}>
              <span className="muted-note" style={{ margin: 0 }}>
                Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, filteredItems.length)} of {filteredItems.length} results
              </span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                  <button key={p} className={`btn ${p === page ? 'primary' : 'ghost'} sm`} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="btn ghost sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>›</button>
              </div>
            </div>
          )}
        </Card>

        <div className="stack">
          <Card title="Verification Overview">
            <div className="donut-wrap">
              <div className="donut">
                <svg viewBox="0 0 120 120" width="100%" height="100%">
                  <g transform="rotate(-90 60 60)">
                    <circle cx={60} cy={60} r={46} fill="none" stroke="var(--surface-3)" strokeWidth={16} />
                    {(() => {
                      const C = 2 * Math.PI * 46
                      let cursor = 0
                      return (['verified', 'flagged', 'pending'] as DocBucket[]).map((b) => {
                        const frac = total ? counts[b] / total : 0
                        const len = Math.max(0, frac * C - (frac > 0 ? 2.5 : 0))
                        const offset = -cursor * C
                        cursor += frac
                        return counts[b] > 0 && (
                          <circle key={b} cx={60} cy={60} r={46} fill="none" stroke={BUCKET_COLOR[b]} strokeWidth={16}
                            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={offset} strokeLinecap="butt" />
                        )
                      })
                    })()}
                  </g>
                </svg>
                <div className="center"><span className="n">{total}</span><span className="c">Total</span></div>
              </div>
              <div className="donut-legend">
                {(['verified', 'flagged', 'pending'] as DocBucket[]).map((b) => (
                  <div className="row" key={b}>
                    <span className="sw" style={{ background: BUCKET_COLOR[b] }} />
                    <span className="nm">{BUCKET_LABEL[b]}</span>
                    <span className="vv">{counts[b]} ({total ? Math.round((counts[b] / total) * 100) : 0}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Top Document Types">
            {topTypes.length === 0 ? <p className="muted-note">No documents yet.</p> : (
              <div className="an2-ranked">
                {topTypes.map(([name, count]) => (
                  <div className="an2-rank-row" key={name}>
                    <div className="an2-rank-top"><span className="nm">{name}</span><span className="vv">{count}</span></div>
                    <div className="an2-rank-track"><div className="an2-rank-fill" style={{ width: `${Math.round((count / (topTypes[0][1] || 1)) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Recent Flagged Documents">
            {flaggedDocs.length === 0 ? <p className="muted-note">Nothing flagged right now.</p> : flaggedDocs.map(({ ext, doc, tag }) => (
              <button className="da-flagged-row" key={doc.name + ext.id} onClick={() => openDoc(ext, doc)}>
                <span className="da-flagged-ic"><Icon name="documents" size={15} /></span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div className="da-flagged-name">{doc.file ?? doc.name}</div>
                  <div className="da-flagged-meta">{ext.source} · {ext.receivedAt}</div>
                </span>
                <Pill tone="crit">{tag}</Pill>
              </button>
            ))}
          </Card>

          <Card title="Document Health Trend (Last 7 Days)">
            <TrendChart
              labels={trendLabels}
              series={[
                { label: 'Verified', color: BUCKET_COLOR.verified, data: trendToward(counts.verified) },
                { label: 'Flagged', color: BUCKET_COLOR.flagged, data: trendToward(counts.flagged) },
                { label: 'Pending', color: BUCKET_COLOR.pending, data: trendToward(counts.pending) },
              ]}
            />
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              {(['verified', 'flagged', 'pending'] as DocBucket[]).map((b) => (
                <span key={b} className="donut-legend row" style={{ padding: 0 }}>
                  <span className="sw" style={{ background: BUCKET_COLOR[b] }} /> <span className="nm">{BUCKET_LABEL[b]}</span>
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

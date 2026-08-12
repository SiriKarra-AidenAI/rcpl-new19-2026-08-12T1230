import './Documents.css'
import { useMemo, useState } from 'react'
import { Button, Modal, Pill, Toggle } from '../components/ui'
import { Icon } from '../components/ui/icons'
import type { IconName } from '../components/ui/icons'
import { CASE_PARTNER, DEMO_DOCUMENTS } from '../mock/cases'
import { PARTNER_TYPE_COLOR, partnerTypeLabel } from '../mock/templates'
import { DEMO_USERS } from '../mock/roles'
import { useApp } from '../store'
import type { PartnerTypeCode, SubmittedDocument, VerificationStatus } from '../types'
import { isBusinessCapacityDoc, BUSINESS_CAPACITY_NOTE } from '../lib/documentPolicy'
import { buildPdf, wrapText, openPdfInNewTab } from '../lib/pdf'
import type { PdfLine } from '../lib/pdf'

type Tab = 'all' | 'pending' | 'verified' | 'not_checked'
const PAGE_SIZES = [10, 25, 50]

const typeShort = (code: PartnerTypeCode) => partnerTypeLabel(code).split(' ')[0]
const partnerName = (caseCode: string) => CASE_PARTNER[caseCode] ?? '—'

// file-glyph tint per document kind, so the list reads like a real doc tray
const DOC_TINT: Record<string, string> = {
  'GST Certificate': 'var(--good)', GST: 'var(--good)', 'ISO 9001': 'var(--good)',
  PAN: 'var(--p-ase)', 'Cancelled Cheque': 'var(--p-ase)',
  'FSSAI License': 'var(--warn)', 'Factory Audit Report': 'var(--warn)',
  'Godown Proof': 'var(--crit)',
  'DB Onboarding Form': 'var(--ai)', MSME: 'var(--ai)',
}
const docTint = (name: string) => DOC_TINT[name] ?? 'var(--ai)'

const STATUS_LABEL: Record<VerificationStatus, string> = {
  verified: 'Verified', pending: 'Pending', mismatch: 'Mismatch', not_checked: 'Not checked',
}

// The issuing authority line shown at the top of a generated document PDF.
function docIssuer(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('gst')) return 'Government of India · GST Department'
  if (n.includes('fssai')) return 'Food Safety & Standards Authority of India'
  if (n.includes('godown')) return 'Warehouse lease / ownership proof'
  if (n.includes('pan')) return 'Income Tax Department'
  if (n.includes('iso')) return 'Quality management certification'
  if (n.includes('factory')) return 'Third-party factory audit'
  if (n.includes('msme')) return 'Ministry of MSME · Udyam'
  if (n.includes('cheque')) return 'Cancelled cheque · bank proof'
  if (n.includes('form') || n.includes('onboarding')) return 'RCPL distributor onboarding'
  return 'Uploaded document'
}
// A realistic document body, built from the claimed/extracted values on file.
function docBodyText(d: SubmittedDocument, firm: string): string {
  const n = d.docName.toLowerCase()
  const claimed = d.claimed ?? '—'
  if (n.includes('gst')) return `Registration certificate issued under the GST Act to ${firm}, GSTIN ${claimed}. Classified as a regular taxpayer, valid from the date of registration.`
  if (n.includes('fssai')) return `This is to certify that ${firm} is licensed as a Food Business Operator under the Food Safety and Standards Act, 2006. License number ${claimed}. Valid for the current registration period.`
  if (n.includes('godown')) return `Warehouse lease / ownership proof for ${firm} — covered storage premises (${claimed}) suitable for RCPL Staples distribution.`
  if (n.includes('pan')) return `Permanent Account Number card for ${firm}, PAN ${claimed}, issued by the Income Tax Department, Government of India.`
  if (n.includes('iso')) return `${firm} holds ISO 9001 certification for its quality management system (${claimed}), verified by an accredited certification body.`
  if (n.includes('factory')) return `Third-party factory audit report for ${firm}. Overall assessment: ${claimed}.`
  if (n.includes('msme')) return `Udyam (MSME) registration certificate for ${firm}, ${claimed}, issued by the Ministry of Micro, Small and Medium Enterprises.`
  if (n.includes('cheque')) return `Cancelled cheque submitted by ${firm} as proof of bank account details for payment set-up — ${claimed}.`
  if (n.includes('form') || n.includes('onboarding')) return `${d.docName} submitted by ${firm} — ${claimed}.`
  return `Uploaded document on file for ${firm}.`
}

function statusView(d: SubmittedDocument) {
  switch (d.status) {
    case 'verified':
      return { pill: <Pill tone="good" dot>Verified</Pill>, sub: d.verifiedOn ? `Verified on ${d.verifiedOn}` : 'Verified' }
    case 'pending':
      return { pill: <Pill tone="warn" dot>Pending</Pill>, sub: 'Awaiting verification' }
    case 'mismatch':
      return { pill: <Pill tone="crit" dot>Mismatch</Pill>, sub: 'Needs review' }
    default:
      return { pill: <Pill tone="neutral">Not checked</Pill>, sub: d.optional ? 'Optional' : '—' }
  }
}

// compact page list with ellipsis for larger sets (1 2 3 … 9)
function pageList(total: number, cur: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const start = Math.max(2, cur - 1)
  const end = Math.min(total - 1, cur + 1)
  if (start > 2) out.push('…')
  for (let i = start; i <= end; i++) out.push(i)
  if (end < total - 1) out.push('…')
  out.push(total)
  return out
}

export function Documents() {
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [ptFilter, setPtFilter] = useState<'all' | PartnerTypeCode>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // MDM workflow state: per-document verification overrides, per-case Document Intelligence
  // toggle, onboarded cases, and which case is open in the document-check modal.
  const [statuses, setStatuses] = useState<Record<string, VerificationStatus>>({})
  const [diCases, setDiCases] = useState<Record<string, boolean>>({})
  const [onboarded, setOnboarded] = useState<string[]>([])
  const [reviewCase, setReviewCase] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const logAudit = useApp((s) => s.logAudit)
  const pushNotification = useApp((s) => s.pushNotification)

  // documents with any live verification override applied
  const docs = useMemo<SubmittedDocument[]>(
    () => DEMO_DOCUMENTS.map((d) => (statuses[d.id] ? { ...d, status: statuses[d.id] } : d)),
    [statuses],
  )

  // "View" generates a real single-page PDF from the on-file data and opens it in a new
  // browser tab (native PDF viewer) — no summary popup.
  const viewPdf = (d: SubmittedDocument) => {
    const firm = partnerName(d.caseCode)
    openPdfInNewTab(buildPdf([
      { text: 'RCPL Partner Platform - Document on file', size: 9, gap: 18 },
      { text: d.docName, size: 18, bold: true, gap: 30 },
      { text: docIssuer(d.docName), size: 10.5, gap: 18 },
      { text: `Partner:   ${firm}`, size: 11, gap: 20 },
      { text: `Partner type:   ${typeShort(d.partnerType)}`, size: 11, gap: 20 },
      { text: `Case:   ${d.caseCode}`, size: 11, gap: 20 },
      { text: `Claimed value:   ${d.claimed ?? '—'}`, size: 11, gap: 20 },
      ...(d.extracted ? [{ text: `Extracted value:   ${d.extracted}`, size: 11, gap: 20 } as PdfLine] : []),
      { text: `Uploaded on:   ${d.uploadedOn ?? '—'}${d.uploadedAt ? ` · ${d.uploadedAt}` : ''}`, size: 11, gap: 20 },
      { text: `Status:   ${STATUS_LABEL[d.status]}`, size: 11, gap: 20 },
      { text: ' ', gap: 12 },
      ...wrapText(docBodyText(d, firm)).map((t): PdfLine => ({ text: t, size: 10.5, gap: 16 })),
      { text: ' ', gap: 20 },
      { text: 'Generated preview PDF - prototype stand-in for the actual scan.', size: 8.5 },
    ]))
  }

  // global stats (all documents), independent of tab/search
  const stats = useMemo(() => {
    const total = docs.length
    const by = (s: VerificationStatus) => docs.filter((d) => d.status === s).length
    const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : '0')
    return { total, verified: by('verified'), pending: by('pending'), notChecked: by('not_checked'), thisWeek: docs.filter((d) => d.thisWeek).length, pct }
  }, [docs])

  // search + partner-type filter (drives both the tab counts and the table)
  const base = useMemo(() => {
    const q = query.trim().toLowerCase()
    return docs.filter((d) => {
      if (ptFilter !== 'all' && d.partnerType !== ptFilter) return false
      if (!q) return true
      return [d.docName, d.caseCode, d.fileName, d.claimed, typeShort(d.partnerType), partnerName(d.caseCode)]
        .some((v) => v?.toLowerCase().includes(q))
    })
  }, [docs, query, ptFilter])

  const tabCounts = useMemo(() => ({
    pending: base.filter((d) => d.status === 'pending').length,
    verified: base.filter((d) => d.status === 'verified').length,
    not_checked: base.filter((d) => d.status === 'not_checked').length,
  }), [base])

  const rows = useMemo(
    () => (tab === 'all' ? base : base.filter((d) => d.status === tab)),
    [base, tab],
  )

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const curPage = Math.min(page, totalPages)
  const start = (curPage - 1) * pageSize
  const pageRows = rows.slice(start, start + pageSize)

  const resetPage = () => setPage(1)
  const filtersActive = ptFilter !== 'all'

  // ---- MDM actions ----
  // Godown Proof evidences a business-capacity claim (godown size), which RCPL's process
  // explicitly leaves to ASE/ASM field judgment — MDM verifies compliance documents only
  // (GST, PAN, FSSAI, etc.), never business-capacity ones, even where technically possible.
  const caseDocs = reviewCase ? docs.filter((d) => d.caseCode === reviewCase) : []
  const verifiableDocs = caseDocs.filter((d) => !isBusinessCapacityDoc(d.docName))
  const diOn = reviewCase ? !!diCases[reviewCase] : false
  const verifyDoc = (id: string) => setStatuses((s) => ({ ...s, [id]: 'verified' }))
  const allVerified = verifiableDocs.length > 0 && verifiableDocs.every((d) => d.status === 'verified')
  const isOnboarded = reviewCase ? onboarded.includes(reviewCase) : false
  const confirmOnboard = () => {
    if (!reviewCase) return
    const who = DEMO_USERS[viewingAs]?.name ?? 'MDM'
    setStatuses((s) => { const next = { ...s }; verifiableDocs.forEach((d) => { next[d.id] = 'verified' }); return next })
    setOnboarded((o) => (o.includes(reviewCase) ? o : [...o, reviewCase]))
    logAudit({ actor: who, kind: 'human', action: `Confirmed & onboarded ${partnerName(reviewCase)}`, entity: reviewCase })
    pushNotification({ title: `${partnerName(reviewCase)} onboarded`, body: `${reviewCase} cleared the MDM document check and is now a live partner.`, href: '/partners' })
    setNotice(`${partnerName(reviewCase)} (${reviewCase}) confirmed & onboarded — logged to the audit trail.`)
  }

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'all', label: 'All Documents' },
    { key: 'pending', label: 'Pending', count: tabCounts.pending },
    { key: 'verified', label: 'Verified', count: tabCounts.verified },
    { key: 'not_checked', label: 'Not Checked', count: tabCounts.not_checked },
  ]

  const STAT_CARDS: { label: string; value: number; sub: string; icon: IconName; fg: string; bg: string }[] = [
    { label: 'Total Documents', value: stats.total, sub: 'Across all cases', icon: 'documents', fg: 'var(--ai)', bg: 'var(--ai-bg)' },
    { label: 'Verified', value: stats.verified, sub: `${stats.pct(stats.verified)}% of total`, icon: 'check', fg: 'var(--good)', bg: 'var(--good-bg)' },
    { label: 'Pending Verification', value: stats.pending, sub: `${stats.pct(stats.pending)}% of total`, icon: 'clock', fg: 'var(--warn)', bg: 'var(--warn-bg)' },
    { label: 'Not Checked', value: stats.notChecked, sub: `${stats.pct(stats.notChecked)}% of total`, icon: 'alert', fg: 'var(--crit)', bg: 'var(--crit-bg)' },
    { label: 'Total Uploaded', value: stats.thisWeek, sub: 'This week', icon: 'upload', fg: 'var(--p-ase)', bg: 'color-mix(in srgb, var(--p-ase) 15%, var(--surface))' },
  ]

  return (
    <div>
      <div className="doc-head">
        <div className="page-head">
          <h1>Documents <span className="page-info-ic" title="Every submitted document is tracked and verified. Open Review on a case to run the document check, turn on Document Intelligence, verify the extracted fields, and confirm & onboard."><Icon name="help" size={13} /></span></h1>
        </div>
        <div className="doc-actions">
          <Button variant="ghost"><Icon name="settings" size={15} /> Document Settings</Button>
          <div className="split-btn">
            <button className="btn primary split-main"><Icon name="plus" size={15} /> Upload Document</button>
            <button className="btn primary split-caret" aria-label="More upload options"><Icon name="chevronDown" size={15} /></button>
          </div>
        </div>
      </div>

      {notice && (
        <div className="notify-bar" style={{ marginBottom: '1rem' }}>
          <Icon name="check" size={14} /> {notice}
          <button className="btn text sm" style={{ marginLeft: 'auto' }} onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="doc-stats">
        {STAT_CARDS.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-top">
              <span className="stat-ic" style={{ color: c.fg, background: c.bg }}><Icon name={c.icon} size={19} /></span>
              <span className="stat-label">{c.label}</span>
            </div>
            <div className="stat-value">{c.value}</div>
            <div className="stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="doc-tabsbar">
        <div className="tabs flush">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); resetPage() }}>
              {t.label}
              {t.count !== undefined && <span className="tab-count">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="doc-tools">
          <label className="doc-search">
            <Icon name="search" size={15} />
            <input value={query} onChange={(e) => { setQuery(e.target.value); resetPage() }} placeholder="Search document, case, type..." />
          </label>
          <Button variant="ghost" size="sm" className={showFilters ? 'active' : ''} onClick={() => setShowFilters((v) => !v)}>
            <Icon name="filter" size={14} /> Filters
          </Button>
          <Button variant="ghost" size="sm"><Icon name="download" size={14} /> Export</Button>
        </div>
      </div>

      {showFilters && (
        <div className="doc-filterbar">
          <div className="doc-filter-field">
            <span>Partner type</span>
            <select value={ptFilter} onChange={(e) => { setPtFilter(e.target.value as typeof ptFilter); resetPage() }}>
              <option value="all">All partner types</option>
              <option value="distributor">Distributor</option>
              <option value="vendor">Vendor</option>
              <option value="logistics">Logistics</option>
              <option value="copacker">Co-packer</option>
            </select>
          </div>
          {filtersActive && <Button variant="text" size="sm" onClick={() => { setPtFilter('all'); resetPage() }}>Reset filters</Button>}
        </div>
      )}

      <div className="dtable-wrap">
        <table className="dtable">
          <thead>
            <tr>
              <th>Case ID</th><th>Type</th><th>Document</th><th>Claimed Value</th><th>Uploaded On</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((d) => {
              const st = statusView(d)
              return (
                <tr key={d.id}>
                  <td>
                    <span className="code">{d.caseCode}</span>
                    <div className="cell-sub">{partnerName(d.caseCode)}{onboarded.includes(d.caseCode) ? ' · onboarded' : ''}</div>
                  </td>
                  <td>
                    <span className="type-badge"><span className="d" style={{ background: PARTNER_TYPE_COLOR[d.partnerType] }} />{typeShort(d.partnerType)}</span>
                  </td>
                  <td>
                    <div className="doc-file">
                      <span className="doc-file-ic" style={{ ['--tint' as string]: docTint(d.docName) }}><Icon name="documents" size={17} /></span>
                      <div>
                        <div className="doc-file-name">{d.docName}</div>
                        {d.fileName && <div className="doc-file-sub">{d.fileName}</div>}
                      </div>
                    </div>
                  </td>
                  <td><span className="doc-claimed">{d.claimed ?? '—'}</span></td>
                  <td>
                    <div className="up-date">{d.uploadedOn ?? '—'}</div>
                    {d.uploadedAt && <div className="up-time">{d.uploadedAt}</div>}
                  </td>
                  <td>
                    <div className="st-cell">{st.pill}<div className="st-sub">{st.sub}</div></div>
                  </td>
                  <td>
                    <div className="act-cell">
                      <Button variant="ghost" size="sm" onClick={() => viewPdf(d)}>View</Button>
                      <Button variant="ghost" size="sm" onClick={() => setReviewCase(d.caseCode)}>Review</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={7}><div className="doc-empty">No documents match this view.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="doc-pager">
        <span className="pager-info">
          {rows.length === 0
            ? 'No documents'
            : `Showing ${start + 1} to ${Math.min(start + pageSize, rows.length)} of ${rows.length} documents`}
        </span>
        <div className="pager-ctrls">
          <button className="pg-btn" disabled={curPage === 1} onClick={() => setPage(curPage - 1)} aria-label="Previous page"><Icon name="back" size={15} /></button>
          {pageList(totalPages, curPage).map((p, i) =>
            p === '…'
              ? <span className="pg-ellipsis" key={`e${i}`}>…</span>
              : <button key={p} className={`pg-num ${p === curPage ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>,
          )}
          <button className="pg-btn" disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)} aria-label="Next page"><Icon name="chevronRight" size={15} /></button>
          <select className="pg-size" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); resetPage() }}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
          </select>
        </div>
      </div>

      {/* MDM case document check + onboard */}
      <Modal open={!!reviewCase} onClose={() => setReviewCase(null)} size="lg"
        title={reviewCase ? `Document check · ${reviewCase} — ${partnerName(reviewCase)}` : 'Document check'}>
        {reviewCase && (
          <>
            <div className="dc-di">
              <Toggle on={diOn} onChange={(v) => setDiCases((s) => ({ ...s, [reviewCase]: v }))}
                label={<><strong>Document Intelligence</strong> — {diOn ? 'extracting & matching claimed vs actual' : 'off (verify receipt manually)'}</>} />
              {isOnboarded && <Pill tone="good" dot>Onboarded</Pill>}
            </div>

            <div className="dtable-wrap" style={{ marginTop: '0.9rem' }}>
              <table className="dtable">
                <thead>
                  <tr><th>Document</th><th>Claimed</th>{diOn && <th>Extracted</th>}{diOn && <th>Match</th>}<th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {caseDocs.map((d) => {
                    const extracted = d.extracted ?? d.claimed ?? '—'
                    const match = (d.claimed ?? '') === (d.extracted ?? d.claimed ?? '')
                    const verified = d.status === 'verified'
                    const excluded = isBusinessCapacityDoc(d.docName)
                    return (
                      <tr key={d.id}>
                        <td className="strong">{d.docName}<div className="cell-sub">{d.fileName}</div></td>
                        <td><span className="doc-claimed">{d.claimed ?? '—'}</span></td>
                        {diOn && <td><span className="doc-claimed">{excluded ? '—' : extracted}</span></td>}
                        {diOn && <td className={excluded ? '' : match ? 'match-ok' : 'match-bad'}>{excluded ? '—' : match ? '✓' : '!'}</td>}
                        <td>{excluded ? <Pill tone="neutral">On file</Pill> : statusView(d).pill}</td>
                        <td>
                          {excluded
                            ? <span className="dc-excluded" title={BUSINESS_CAPACITY_NOTE}>Not verified by policy</span>
                            : verified
                              ? <span className="dc-done">✓ {diOn ? 'Verified' : 'Checked'}</span>
                              : <Button size="sm" onClick={() => verifyDoc(d.id)}>{diOn ? 'Mark verified' : 'Mark checked'}</Button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="dc-foot">
              <span className="dc-progress">
                {verifiableDocs.filter((d) => d.status === 'verified').length}/{verifiableDocs.length} verified
                {caseDocs.length > verifiableDocs.length && ` · ${caseDocs.length - verifiableDocs.length} on file, not verified by policy`}
              </span>
              {isOnboarded
                ? <Pill tone="good" dot>Confirmed &amp; onboarded</Pill>
                : <Button disabled={!allVerified} onClick={confirmOnboard}
                    title={allVerified ? undefined : 'Verify every document first'}>
                    <Icon name="check" size={14} /> Confirm &amp; onboard {partnerName(reviewCase)}
                  </Button>}
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

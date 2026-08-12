import './Leads.css'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { CANDIDATE_STAGES, isMyLead } from '../mock/candidates'
import { INFRA_THRESHOLD, FIN_EVAL_PASS } from '../mock/onboarding'
import { CONTRIBUTION_MIN, contributionPctFor } from '../lib/roi'
import { REQUIRED_DOCS } from '../mock/intake'
import { ROLE_BY_CODE } from '../mock/roles'
import { useApp, useMe } from '../store'
import { WorkbasketPanel } from './Workbasket'
import { worklistFor } from '../lib/workbasket'
import type { CandidateCard, CandidateStage } from '../types'

const SUBTYPE_SHORT: Record<string, string> = { new: 'New', replacement: 'Replacement', additional: 'Additional' }
const PAGE_SIZE = 10

// The Leads page shows two tabs: the leads a user reviewed & created from the Intake Inbox
// ("Leads you created"), and — for the field team — the DBs their RBL/ASM has actually handed
// them to work ("DBs assigned to me" / the shared DB Pool for assigners).
export function Leads() {
  const allCandidates = useApp((s) => s.candidates)
  const evalIds = useApp((s) => s.evalIds)
  const workbasket = useApp((s) => s.workbasket)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const reinstateCandidate = useApp((s) => s.reinstateCandidate)
  const me = useMe()
  const navigate = useNavigate()
  const location = useLocation()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'created' | 'assigned'>('created')
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [stageFilter, setStageFilter] = useState<'all' | CandidateStage>('all')
  const [page, setPage] = useState(1)
  // Deep-link: opening Leads with { state: { openLeadId } } (e.g. Dashboard's "View lead") expands
  // straight to that lead's own profile instead of dropping you on the generic list — matching how
  // Approvals' "View case" already deep-links to the specific case. scrollToId only fires the
  // auto-scroll once, right after a deep-link lands — a manual row click is already in view.
  const [scrollToId, setScrollToId] = useState<string | null>(null)
  useEffect(() => {
    const id = (location.state as { openLeadId?: string } | null)?.openLeadId
    if (id) { setExpandedId(id); setTab('created'); setScrollToId(id) }
  }, [location.state])
  // Passed down to WorkbasketPanel so clicking a DB that's already become a lead (in_progress/done)
  // jumps straight to its detail — a direct state update, not a router round-trip, since
  // WorkbasketPanel is rendered as a child of this same component on this same route (navigating
  // to the same pathname doesn't reliably re-trigger the openLeadId effect above).
  const openLead = (id: string) => { setExpandedId(id); setTab('created'); setScrollToId(id) }

  const isAse = viewingAs === 'ase_asm'
  // 'active' means fully onboarded — it now has a real Partner record and belongs in Partners.
  const candidates = allCandidates.filter((c) =>
    c.userCreated && c.stage !== 'active' && (viewingAs !== 'ase_asm' || isMyLead(c, me?.id, viewingAs)))
  const shortlisted = candidates.filter((c) => evalIds.includes(c.id))
  const canOpenWizard = viewingAs !== 'ase_asm'
  // The RBL is a supervisor — the field-team's created leads aren't their concern; they work the pool.
  const showCreatedLeads = viewingAs !== 'rbl'

  // Matches WorkbasketPanel's own canAssign — ASM/RBL/admin see the shared pool; everyone else
  // (ASE, and any other role that lands on this page) sees just their own assigned worklist.
  // Keeping this in sync with WorkbasketPanel means the tab's label/count never contradicts what
  // that panel actually renders underneath it.
  const canAssignPool = viewingAs === 'asm' || viewingAs === 'rbl' || viewingAs === 'admin'
  const myAssignedCount = useMemo(() => (me?.id ? worklistFor(workbasket, me.id).length : 0), [workbasket, me?.id])
  const assignedTabLabel = canAssignPool ? 'DB Pool' : 'DBs assigned to me'
  const assignedTabCount = canAssignPool ? workbasket.length : myAssignedCount

  const dbTypes = useMemo(() => [...new Set(candidates.map((c) => c.dbCategory))].sort(), [candidates])
  const filtered = candidates
    .filter((c) => typeFilter === 'all' || c.dbCategory === typeFilter)
    .filter((c) => stageFilter === 'all' || c.stage === stageFilter)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages)
  const start = (curPage - 1) * PAGE_SIZE
  const pageRows = filtered.slice(start, start + PAGE_SIZE)
  const activeFilterCount = (typeFilter !== 'all' ? 1 : 0) + (stageFilter !== 'all' ? 1 : 0)

  const exportCsv = () => {
    const head = ['Lead', 'Town', 'Category', 'Turnover (₹L/mo)', 'Coverage (OL)', 'Stage', 'Confidence', 'Created on']
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines = filtered.map((c) => [
      c.name, c.town, c.dbCategory, c.turnoverMonthly, c.coverageOutlets,
      CANDIDATE_STAGES.find((s) => s.id === c.stage)?.label ?? c.stage, `${c.confidencePct}%`,
      c.createdAt ? new Date(c.createdAt).toLocaleString('en-IN') : '—',
    ].map(esc).join(','))
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'leads.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="page-head">
        <div className="row-between">
          <div>
            <h1>Leads <span className="page-info-ic" title={isAse
              ? 'Leads you created from the Intake Inbox, plus the DBs your RBL/ASM has assigned to you.'
              : 'Leads the field team created, plus the shared DB Pool / worklist for the appointment pipeline.'}><Icon name="help" size={13} /></span></h1>
            <p className="page-sub">Manage leads you created and DBs assigned to you.</p>
          </div>
          {isAse && (
            <Button onClick={() => navigate('/intake-inbox', { state: { openCreateLead: true } })}>
              <Icon name="new" size={14} /> Create Lead
            </Button>
          )}
        </div>
      </div>

      {showCreatedLeads ? (
        <div className="card" style={{ padding: 0 }}>
          <div className="tabs" style={{ margin: '0 1.15rem', paddingTop: '0.4rem' }}>
            <button className={`tab ${tab === 'created' ? 'active' : ''}`} onClick={() => setTab('created')}>
              {isAse ? 'Leads you created' : 'Leads created by the field team'} <span className="tab-count">{candidates.length}</span>
            </button>
            <button className={`tab ${tab === 'assigned' ? 'active' : ''}`} onClick={() => setTab('assigned')}>
              {assignedTabLabel} <span className="tab-count">{assignedTabCount}</span>
            </button>
          </div>

          {tab === 'created' ? (
            candidates.length === 0 ? (
              <div style={{ padding: '2rem 1.25rem', textAlign: 'center' }}>
                <p style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '0.35rem' }}>No leads created yet</p>
                <p className="muted-note" style={{ marginBottom: '1rem' }}>
                  Review an enquiry in the Intake Inbox and click “Review &amp; create lead” — it will appear here.
                </p>
                <Button onClick={() => navigate('/intake-inbox')}><Icon name="comms" size={14} /> Open Intake Inbox</Button>
              </div>
            ) : (<>
              <div className="ld-toolbar">
                <Button variant="ghost" size="sm" className={showFilters ? 'active' : ''} onClick={() => setShowFilters((v) => !v)}>
                  <Icon name="filter" size={14} /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </Button>
                <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }} aria-label="Filter by DB category">
                  <option value="all">All Types</option>
                  {dbTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {showFilters && (
                  <select value={stageFilter} onChange={(e) => { setStageFilter(e.target.value as typeof stageFilter); setPage(1) }} aria-label="Filter by stage">
                    <option value="all">All Stages</option>
                    {CANDIDATE_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                )}
                <span className="ld-spacer" />
                <Button variant="ghost" size="sm" onClick={exportCsv}><Icon name="download" size={14} /> Export</Button>
              </div>

              <div className="dtable-wrap" style={{ border: 'none' }}>
                <table className="dtable">
                  <thead><tr><th></th><th>Lead</th><th>Town · Category</th><th>Turnover (₹L/mo)</th><th>Coverage (OL)</th><th>Stage</th><th>Confidence</th><th>Created on</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {pageRows.map((c, i) => {
                      const open = expandedId === c.id
                      const leadCode = `LEAD-${String(filtered.length - (start + i)).padStart(4, '0')}`
                      return (
                        <Fragment key={c.id}>
                          <tr className="clickable" onClick={() => setExpandedId(open ? null : c.id)}>
                            <td style={{ width: 26, color: 'var(--ink-mute)' }}>{open ? '▾' : '▸'}</td>
                            <td className="strong">
                              {c.name}
                              <div className="cell-sub">{leadCode} <Pill tone="ai">{SUBTYPE_SHORT[c.subtype ?? 'new'] ?? 'New'}</Pill></div>
                            </td>
                            <td>{c.town} · {c.dbCategory}</td>
                            <td>{c.turnoverMonthly}</td>
                            <td>{c.coverageOutlets.toLocaleString()}</td>
                            <td><Pill tone={c.stage === 'rejected' ? 'crit' : 'warn'}>{CANDIDATE_STAGES.find((s) => s.id === c.stage)?.label ?? c.stage}</Pill></td>
                            <td>
                              <div className="ld-conf">
                                <div className="ld-conf-bar"><i style={{ width: `${c.confidencePct}%` }} /></div>
                                <span>{c.confidencePct}%</span>
                              </div>
                            </td>
                            <td className="cell-sub">{c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                              {c.createdAt && <div>{new Date(c.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</div>}</td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="sm" onClick={() => setExpandedId(open ? null : c.id)}>View Lead</Button>
                            </td>
                          </tr>
                          {open && (
                            <tr className="lead-detail-row"
                              ref={(el) => { if (el && c.id === scrollToId) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setScrollToId(null) } }}>
                              <td colSpan={9}>
                                <LeadDetail c={c} shortlisted={evalIds.includes(c.id)} canOpenWizard={canOpenWizard}
                                  onCompare={() => navigate('/new-application')}
                                  onReinstate={() => { reinstateCandidate(c.id); if (canOpenWizard) navigate('/new-application') }} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="ld-foot">
                <span className="ld-foot-count">
                  {filtered.length === 0 ? 'No leads match these filters'
                    : `Showing ${start + 1} to ${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} lead${filtered.length === 1 ? '' : 's'}`}
                </span>
                {totalPages > 1 && (
                  <div className="ld-pager">
                    <button className="ld-pg" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} aria-label="Previous page"><Icon name="back" size={14} /></button>
                    {Array.from({ length: totalPages }, (_, n) => n + 1).map((p) => (
                      <button key={p} className={`ld-pg ${p === curPage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
                    ))}
                    <button className="ld-pg" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)} aria-label="Next page"><Icon name="chevronRight" size={14} /></button>
                  </div>
                )}
              </div>

              {shortlisted.length > 0 && canOpenWizard && (
                <div className="row-between" style={{ padding: '0.9rem 1.15rem', borderTop: '1px solid var(--border)' }}>
                  <span className="muted-note" style={{ margin: 0 }}>{shortlisted.length} shortlisted for comparison — compared side by side in New Application.</span>
                  <Button size="sm" onClick={() => navigate('/new-application')}>
                    <Icon name="new" size={13} /> {shortlisted.length > 1 ? 'Compare in New Application' : 'Open in New Application'}
                  </Button>
                </div>
              )}
            </>)
          ) : (
            <div style={{ padding: '1rem 1.15rem' }}>
              <WorkbasketPanel onOpenLead={openLead} />
            </div>
          )}
        </div>
      ) : (
        <WorkbasketPanel onOpenLead={openLead} />
      )}
    </div>
  )
}

// Full profile of a created lead — everything recorded on the candidate, plus how it
// stands against the evaluation thresholds Channel Development will score it on.
function LeadDetail({ c, shortlisted, canOpenWizard, onCompare, onReinstate }:
  { c: CandidateCard; shortlisted: boolean; canOpenWizard: boolean; onCompare: () => void; onReinstate: () => void }) {
  const setCandidateDoc = useApp((s) => s.setCandidateDoc)
  const chanPass = c.infraScore >= INFRA_THRESHOLD && contributionPctFor(c.turnoverMonthly, c.expectedRcplTurnover) >= CONTRIBUTION_MIN
  const finPass = c.finEvalPct >= FIN_EVAL_PASS
  const stats: { k: string; v: string }[] = [
    { k: 'Monthly turnover', v: `₹${c.turnoverMonthly}L` },
    { k: 'Expected RCPL turnover/mo', v: `₹${c.expectedRcplTurnover}L` },
    { k: 'Coverage', v: `${c.coverageOutlets.toLocaleString()} outlets` },
    { k: 'Infrastructure score', v: `${c.infraScore.toFixed(1)}/10` },
    { k: 'Financial evaluation', v: `${c.finEvalPct}%` },
    { k: 'Lead confidence', v: `${c.confidencePct}%` },
  ]
  // Which doc name the (single, shared) hidden file input is currently uploading for.
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const openUpload = (name: string) => { setUploadingDoc(name); fileInputRef.current?.click() }
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const docKey = uploadingDoc
    if (!file || !docKey) return
    const reader = new FileReader()
    reader.onload = () => setCandidateDoc(c.id, docKey, file.name, typeof reader.result === 'string' ? reader.result : undefined)
    reader.readAsDataURL(file)
  }
  return (
    <div className="lead-detail">
      <div className="ld-grid">
        {stats.map((s) => (
          <div className="ld-stat" key={s.k}>
            <span className="k">{s.k}</span>
            <span className="v">{s.v}</span>
          </div>
        ))}
      </div>
      <div className="ld-checks">
        <Pill tone={chanPass ? 'good' : 'warn'} dot>Channel {c.infraScore.toFixed(1)}/10 · {chanPass ? 'Clear' : `Below ${INFRA_THRESHOLD.toFixed(1)} threshold`}</Pill>
        <Pill tone={finPass ? 'good' : 'crit'} dot>Financial {c.finEvalPct}% · {finPass ? 'Clear' : 'Out of range'}</Pill>
        <Pill tone={finPass && chanPass ? 'good' : 'warn'}>{finPass && chanPass ? 'Likely auto-clear' : 'Likely needs review'}</Pill>
      </div>
      <div className="ld-meta">
        Created by <b>{c.createdBy ? ROLE_BY_CODE[c.createdBy]?.label ?? c.createdBy : '—'}</b>
        {c.createdAt && <> · {new Date(c.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</>}
        {' '}· {shortlisted ? 'Shortlisted for side-by-side comparison' : 'Not in the comparison shortlist yet'}
      </div>

      <div className="ld-docs">
        <div className="ld-docs-h">Documents</div>
        <div className="ld-docs-list">
          {REQUIRED_DOCS.map((name) => {
            const doc = c.documents?.[name]
            return (
              <div className="ld-doc-row" key={name}>
                <Icon name={doc ? 'check' : 'documents'} size={14} />
                <span className="ld-doc-name">{name}</span>
                {doc ? (
                  <span className="ld-doc-status ok">
                    <Icon name="check" size={12} /> {doc.name}
                    {doc.dataUrl && <button className="btn text sm" onClick={() => window.open(doc.dataUrl, '_blank')}>View</button>}
                    <button className="btn text sm" onClick={() => openUpload(name)}>Replace</button>
                  </span>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => openUpload(name)}><Icon name="documents" size={13} /> Upload</Button>
                )}
              </div>
            )
          })}
        </div>
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={onPickFile} />
      </div>

      {c.stage === 'rejected' ? (
        <Button size="sm" variant="ghost" onClick={onReinstate}>↺ Send back to New Application</Button>
      ) : canOpenWizard
        ? <Button size="sm" onClick={onCompare}>Compare in New Application →</Button>
        : <p className="muted-note" style={{ margin: 0 }}>Channel Development picks this up in New Application for the side-by-side comparison and appointment.</p>}
    </div>
  )
}

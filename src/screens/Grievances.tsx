import './Grievances.css'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Button, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import type { IconName } from '../components/ui/icons'
import { useApp } from '../store'
import { CATEGORY_TONE } from '../mock/grievances'
import type { Grievance, GrievanceCategory, GrievancePriority, GrievanceStatus } from '../mock/grievances'
import { ROLE_BY_CODE } from '../mock/roles'

const STATUS_LABEL: Record<GrievanceStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }
const statusPill = (s: GrievanceStatus) =>
  s === 'resolved' ? <Pill tone="good" dot>Resolved</Pill>
    : s === 'in_progress' ? <Pill tone="ai" dot>In progress</Pill>
      : <Pill tone="warn" dot>Open</Pill>
const priorityPill = (p: GrievancePriority) =>
  p === 'high' ? <Pill tone="crit" dot>High</Pill>
    : p === 'medium' ? <Pill tone="warn" dot>Medium</Pill>
      : <Pill tone="good" dot>Low</Pill>

// Left-rail icon per grievance category (tinted with CATEGORY_TONE).
const CATEGORY_ICON: Record<GrievanceCategory, IconName> = {
  'Payments & credit': 'dollar',
  'Supply & stock': 'partners',
  'Scheme & claims': 'documents',
  Logistics: 'target',
  'System access': 'monitor',
  'Onboarding delay': 'clock',
  Other: 'flag',
}

// The four display states the list shows (derived from status + isOverdue).
type DisplayKey = 'open' | 'in_review' | 'overdue' | 'closed'
const displayStatus = (g: Grievance): { key: DisplayKey; label: string; tone: 'good' | 'warn' | 'crit' } =>
  g.status === 'resolved' ? { key: 'closed', label: 'Closed', tone: 'good' }
    : g.isOverdue ? { key: 'overdue', label: 'Overdue', tone: 'crit' }
      : g.status === 'in_progress' ? { key: 'in_review', label: 'In Review', tone: 'warn' }
        : { key: 'open', label: 'Open', tone: 'crit' }
const ageLabel = (d: number) => (d <= 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'} ago`)

const PAGE_SIZES = [10, 20, 50]

export function Grievances() {
  const grievances = useApp((s) => s.grievances)
  const setGrievanceStatus = useApp((s) => s.setGrievanceStatus)
  const sendGrievanceUpdate = useApp((s) => s.sendGrievanceUpdate)
  const setCopilotOpen = useApp((s) => s.setCopilotOpen)
  const logAudit = useApp((s) => s.logAudit)
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [priorityF, setPriorityF] = useState<'all' | GrievancePriority>('all')
  const [statusF, setStatusF] = useState<'all' | DisplayKey>('all')
  const [raisedByF, setRaisedByF] = useState<'all' | string>('all')
  const [timeF, setTimeF] = useState<'all' | '7' | '30' | '90'>('all')
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const location = useLocation()
  // deep-link support — other screens (e.g. GTM Coverage) can navigate here with a specific
  // grievance id in location.state to open it directly instead of landing on the list.
  useEffect(() => {
    const id = (location.state as { openId?: string } | null)?.openId
    if (id) setOpenId(id)
  }, [location.state])

  const raisedByOptions = useMemo(() => [...new Set(grievances.map((g) => g.distributor))].sort(), [grievances])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => grievances.filter((g) => {
    if (priorityF !== 'all' && g.priority !== priorityF) return false
    if (statusF !== 'all' && displayStatus(g).key !== statusF) return false
    if (raisedByF !== 'all' && g.distributor !== raisedByF) return false
    if (timeF !== 'all' && g.ageDays > Number(timeF)) return false
    if (q && !g.subject.toLowerCase().includes(q) && !g.distributor.toLowerCase().includes(q) && !g.town.toLowerCase().includes(q)) return false
    return true
  }), [grievances, priorityF, statusF, raisedByF, timeF, q])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage))
  const curPage = Math.min(page, totalPages)
  const start = (curPage - 1) * rowsPerPage
  const pageRows = filtered.slice(start, start + rowsPerPage)
  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1) }

  const open = grievances.find((g) => g.id === openId) ?? null
  if (open) {
    return <GrievanceDetail g={open} onBack={() => setOpenId(null)} onStatus={setGrievanceStatus}
      onEmail={sendGrievanceUpdate} onAsk={() => setCopilotOpen(true)} />
  }

  const exportCsv = () => {
    const head = ['ID', 'Grievance', 'Raised By', 'Town', 'Priority', 'Status', 'Age (days)', 'Raised On']
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines = filtered.map((g) => [g.id, g.subject, g.distributor, g.town, g.priority, displayStatus(g).label, g.ageDays, g.raisedOn].map(esc).join(','))
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'grievances.csv'; a.click()
    URL.revokeObjectURL(url)
    logAudit({ actor: 'You', kind: 'human', action: `Exported ${filtered.length} grievances to CSV`, entity: 'Grievances' })
  }

  return (
    <div>
      <div className="page-head">
        <h1>Grievances <span className="page-info-ic" title="Issues raised by distributors — payments, supply, scheme claims, logistics and access. The Intake Agent logs and classifies incoming grievances; the right team picks them up and resolves against SLA."><Icon name="help" size={13} /></span></h1>
      </div>

      <div className="card grv-panel">
        <div className="grv-toolbar">
          <select value={priorityF} onChange={(e) => resetPage(setPriorityF)(e.target.value as typeof priorityF)}>
            <option value="all">All Priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
          <select value={statusF} onChange={(e) => resetPage(setStatusF)(e.target.value as typeof statusF)}>
            <option value="all">All Status</option><option value="open">Open</option><option value="in_review">In Review</option><option value="overdue">Overdue</option><option value="closed">Closed</option>
          </select>
          <select value={raisedByF} onChange={(e) => resetPage(setRaisedByF)(e.target.value)}>
            <option value="all">All Raised By</option>
            {raisedByOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={timeF} onChange={(e) => resetPage(setTimeF)(e.target.value as typeof timeF)}>
            <option value="all">All Time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
          </select>
          <div className="grv-search"><Icon name="search" size={15} /><input placeholder="Search grievances…" value={query} onChange={(e) => resetPage(setQuery)(e.target.value)} /></div>
          <Button variant="ghost" size="sm" className="grv-export" onClick={exportCsv}><Icon name="upload" size={14} /> Export</Button>
        </div>

        <div className="dtable-wrap" style={{ border: 'none' }}>
          <table className="dtable grv-table">
            <thead><tr><th>Grievance</th><th>Raised By</th><th>Priority</th><th>Status</th><th>Age</th><th aria-label="Open" /></tr></thead>
            <tbody>
              {pageRows.map((g) => {
                const st = displayStatus(g)
                return (
                  <tr key={g.id} className="clickable" onClick={() => setOpenId(g.id)}>
                    <td>
                      <div className="grv-cell">
                        <span className="grv-ic" style={{ color: CATEGORY_TONE[g.category], background: `color-mix(in srgb, ${CATEGORY_TONE[g.category]} 14%, transparent)` }}>
                          <Icon name={CATEGORY_ICON[g.category]} size={16} />
                        </span>
                        <div className="grv-cell-txt">
                          <div className="grv-title">{g.subject}</div>
                          <div className="grv-sub">Raised by {g.distributor}</div>
                        </div>
                      </div>
                    </td>
                    <td className="grv-muted">{g.distributor}</td>
                    <td>{priorityPill(g.priority)}</td>
                    <td><Pill tone={st.tone} dot>{st.label}</Pill></td>
                    <td className="grv-muted grv-nowrap">{ageLabel(g.ageDays)}</td>
                    <td className="grv-chev"><Icon name="chevronRight" size={16} /></td>
                  </tr>
                )
              })}
              {pageRows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: '2.5rem' }}>No grievances match these filters.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="grv-foot">
          <span className="grv-foot-count">{total === 0 ? 'No grievances' : `Showing ${start + 1} to ${Math.min(start + rowsPerPage, total)} of ${total} grievances`}</span>
          <div className="grv-pager">
            <button className="grv-pg" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} aria-label="Previous page"><Icon name="back" size={14} /></button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button key={p} className={`grv-pg ${p === curPage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button className="grv-pg" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)} aria-label="Next page"><Icon name="chevronRight" size={14} /></button>
          </div>
          <label className="grv-rpp">Rows per page:
            <select value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1) }}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>
    </div>
  )
}

function GrievanceDetail({ g, onBack, onStatus, onEmail, onAsk }: {
  g: Grievance; onBack: () => void; onStatus: (id: string, s: GrievanceStatus) => void
  onEmail: (id: string) => void; onAsk: () => void
}) {
  const owner = ROLE_BY_CODE[g.ownerRole]?.label ?? g.ownerRole
  const alreadyEmailed = g.updates.some((u) => u.note.startsWith('Emailed distributor:'))
  return (
    <div>
      <div className="page-head">
        <button className="btn text sm" style={{ padding: 0 }} onClick={onBack}>← Back to grievances</button>
      </div>

      <div className="grv-detail">
        <div className="grv-main card">
          <div className="grv-detail-head">
            <div>
              <div className="grv-idrow"><span className="code">{g.id}</span>{statusPill(g.status)}{priorityPill(g.priority)}</div>
              <h2>{g.subject}</h2>
              <div className="grv-meta">
                <span className="type-badge"><span className="d" style={{ background: CATEGORY_TONE[g.category] }} />{g.category}</span>
                <span>· {g.distributor}, {g.town}</span>
                <span>· via {g.channel}</span>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onAsk}><Icon name="spark" size={13} /> Ask copilot</Button>
          </div>

          <p className="grv-body">{g.detail}</p>

          <div className="grv-timeline">
            <div className="card-title">Activity</div>
            {g.updates.map((u, i) => (
              <div className="grv-event" key={i}>
                <span className="grv-dot" />
                <div>
                  <div className="grv-event-note">{u.note}</div>
                  <div className="grv-event-meta">{u.by} · {u.on}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="grv-side">
          <div className="card">
            <div className="card-title">Details</div>
            <div className="kv-grid">
              <div className="kv"><div className="k">Raised on</div><div className="v">{g.raisedOn}</div></div>
              <div className="kv"><div className="k">Age</div><div className="v">{g.ageDays}d</div></div>
              <div className="kv"><div className="k">Owner team</div><div className="v" style={{ fontSize: '0.85rem' }}>{owner}</div></div>
              <div className="kv"><div className="k">SLA</div><div className="v" style={{ fontSize: '0.85rem', color: g.isOverdue ? 'var(--crit-text)' : 'var(--ink)' }}>{g.slaLabel}</div></div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Update status</div>
            <div className="grv-status-actions">
              {(['open', 'in_progress', 'resolved'] as GrievanceStatus[]).map((s) => (
                <button key={s} className={`grv-status-btn ${g.status === s ? 'active' : ''}`}
                  disabled={g.status === s} onClick={() => onStatus(g.id, s)}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <p className="muted-note" style={{ marginTop: '0.7rem' }}>Changing status is logged to the activity trail.</p>
          </div>

          <div className="card">
            <div className="card-title">Distributor update</div>
            <p className="muted-note" style={{ marginTop: 0 }}>
              Send a holding reply letting {g.distributor} know the review is underway — moves this to In progress and opens the thread in Communication.
            </p>
            <Button size="sm" onClick={() => onEmail(g.id)} disabled={alreadyEmailed}>
              <Icon name="mail" size={13} /> {alreadyEmailed ? 'Update already sent' : 'Email distributor'}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}

import './AuditLog.css'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui'
import { Icon } from '../components/ui/icons'
import type { IconName } from '../components/ui/icons'
import { useApp } from '../store'
import type { AuditEntry } from '../mock/audit'

const KIND_META: Record<AuditEntry['kind'], { label: string; icon: IconName; tone: 'ai' | 'good' | 'warn' }> = {
  ai: { label: 'AI Agent', icon: 'spark', tone: 'ai' },
  human: { label: 'User', icon: 'user', tone: 'good' },
  admin: { label: 'Admin', icon: 'shield', tone: 'warn' },
}
// Older/persisted sessions can carry an entry logged under a kind that predates the current
// type — fall back instead of crashing the whole page on an unrecognized value.
const FALLBACK_KIND_META = { label: 'User', icon: 'user' as IconName, tone: 'good' as const }
const kindMeta = (kind: AuditEntry['kind']) => KIND_META[kind] ?? FALLBACK_KIND_META
const PAGE_SIZE = 8

function actorCell(e: AuditEntry) {
  const meta = kindMeta(e.kind)
  return (
    <span className="al-actor">
      <span className={`al-actor-ic tone-${meta.tone}`}><Icon name={meta.icon} size={14} /></span>
      <span>
        <span className="al-actor-name">{e.actor}</span>
        <span className="al-actor-kind">{meta.label}</span>
      </span>
    </span>
  )
}

// Case-code entities (from Approvals/Documents) are worth a click-through; everything else
// (partner names, template names, email addresses) is display-only.
const CASE_ENTITY = /^(CMP|VND)-\d+/
function entityCell(e: AuditEntry, navigate: (path: string) => void) {
  if (CASE_ENTITY.test(e.entity)) {
    return <button className="al-entity-link" onClick={() => navigate('/approvals')}>{e.entity}</button>
  }
  return <span>{e.entity}</span>
}

// `when` is always "D Mon, HH:MM" (24h, see store.ts auditStamp) — split into a date key
// for day-grouping and a 12-hour time for the row itself.
function splitWhen(when: string): { date: string; time: string } {
  const i = when.lastIndexOf(',')
  if (i === -1) return { date: when, time: '' }
  const date = when.slice(0, i).trim()
  const [hStr, m] = when.slice(i + 1).trim().split(':')
  let h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return { date, time: `${String(h).padStart(2, '0')}:${m ?? '00'} ${ampm}` }
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const todayDateKey = () => { const d = new Date(); return `${d.getDate()} ${MONTHS[d.getMonth()]}` }
// Displayed group header: "2 JUL 2026" — the mock's `when` carries no year, so the current
// year is assumed (fine for a single-session demo log).
const dayHeader = (dateKey: string) => `${dateKey} ${new Date().getFullYear()}`.toUpperCase()

function downloadAuditCsv(entries: AuditEntry[]) {
  const header = ['When', 'Actor', 'Kind', 'Action', 'Entity']
  const rows = entries.map((e) => [e.when, e.actor, kindMeta(e.kind).label, e.action, e.entity])
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'audit_log.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// Compact page-number list with ellipsis (1 2 3 … 9), same shape as Documents' pager.
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

export function AuditLog() {
  const log = useApp((s) => s.auditLog)
  const navigate = useNavigate()
  const [kind, setKind] = useState<'all' | AuditEntry['kind']>('all')
  const [query, setQuery] = useState('')
  const [actorFilter, setActorFilter] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const filtersRef = useRef<HTMLDivElement>(null)

  const actors = useMemo(() => Array.from(new Set(log.map((e) => e.actor))).sort(), [log])
  const counts = useMemo(() => log.reduce(
    (a, e) => { a[e.kind]++; return a },
    { ai: 0, human: 0, admin: 0 } as Record<AuditEntry['kind'], number>,
  ), [log])
  const todayCount = useMemo(() => log.filter((e) => splitWhen(e.when).date === todayDateKey()).length, [log])

  const q = query.trim().toLowerCase()
  const rows = log.filter((e) =>
    (kind === 'all' || e.kind === kind) &&
    (actorFilter === 'all' || e.actor === actorFilter) &&
    (q === '' || [e.actor, e.action, e.entity].some((v) => v.toLowerCase().includes(q))))

  const activeFilterCount = actorFilter !== 'all' ? 1 : 0
  const resetFilters = () => setActorFilter('all')
  useEffect(() => setPage(1), [kind, query, actorFilter])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages)
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)

  // Group the current page's (already newest-first) rows into day sections.
  const groups = useMemo(() => {
    const out: { date: string; entries: AuditEntry[] }[] = []
    for (const e of pageRows) {
      const { date } = splitWhen(e.when)
      const last = out[out.length - 1]
      if (last && last.date === date) last.entries.push(e)
      else out.push({ date, entries: [e] })
    }
    return out
  }, [pageRows])

  const STATS: { label: string; value: number; sub: string; icon: IconName; tone: string }[] = [
    { label: 'Total events', value: log.length, sub: 'All time', icon: 'list', tone: 'ai' },
    { label: 'AI agent actions', value: counts.ai, sub: 'All time', icon: 'spark', tone: 'ai' },
    { label: 'Human actions', value: counts.human, sub: 'All time', icon: 'user', tone: 'good' },
    { label: 'Today', value: todayCount, sub: todayCount > 0 ? `${todayCount} event${todayCount > 1 ? 's' : ''} today` : 'No events today', icon: 'clock', tone: 'warn' },
  ]

  return (
    <div>
      <div className="page-head">
        <h1>Audit Log <span className="page-info-ic" title="Track and review all actions across the platform."><Icon name="help" size={13} /></span></h1>
      </div>

      <div className="al-tiles">
        {STATS.map((s) => (
          <div className="al-tile" key={s.label}>
            <span className={`al-tile-ic tone-${s.tone}`}><Icon name={s.icon} size={18} /></span>
            <div className="al-tile-label">{s.label}</div>
            <div className="al-tile-val">{s.value}</div>
            <div className="al-tile-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="pt-toolbar">
        <div className="tabs">
          <button className={`tab ${kind === 'all' ? 'active' : ''}`} onClick={() => setKind('all')}>All</button>
          <button className={`tab ${kind === 'ai' ? 'active' : ''}`} onClick={() => setKind('ai')}>AI Agents ({counts.ai})</button>
          <button className={`tab ${kind === 'human' ? 'active' : ''}`} onClick={() => setKind('human')}>Human ({counts.human})</button>
          <button className={`tab ${kind === 'admin' ? 'active' : ''}`} onClick={() => setKind('admin')}>Admin ({counts.admin})</button>
        </div>
        <div className="pt-toolbar-actions">
          <span className="pt-search"><Icon name="search" size={14} />
            <input placeholder="Search actor, action, or entity…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <div className="pt-filter-wrap" ref={filtersRef}>
            <Button variant="ghost" size="sm" onClick={() => setFiltersOpen((v) => !v)}>
              <Icon name="filter" size={13} /> Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
            </Button>
            {filtersOpen && (
              <div className="pt-filter-pop">
                <div className="pt-filter-group">
                  <div className="pt-filter-label">Actor</div>
                  <div className="pt-filter-opts">
                    <button className={`pt-filter-chip ${actorFilter === 'all' ? 'on' : ''}`} onClick={() => setActorFilter('all')}>All</button>
                    {actors.map((a) => (
                      <button key={a} className={`pt-filter-chip ${actorFilter === a ? 'on' : ''}`} onClick={() => setActorFilter(a)}>{a}</button>
                    ))}
                  </div>
                </div>
                <div className="pt-filter-foot">
                  <button className="btn text sm" onClick={resetFilters}>Clear</button>
                  <button className="btn sm" onClick={() => setFiltersOpen(false)}>Done</button>
                </div>
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => downloadAuditCsv(rows)}><Icon name="download" size={13} /> Export</Button>
        </div>
      </div>

      <div className="dtable-wrap">
        <table className="dtable al-table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: '1.6rem 0' }}>
                No events match these filters. <button className="btn text sm" style={{ padding: 0 }} onClick={() => { setKind('all'); setQuery(''); resetFilters() }}>Reset</button>
              </td></tr>
            )}
            {groups.map((g) => (
              <Fragment key={g.date}>
                <tr className="al-day"><td colSpan={5}>{dayHeader(g.date)}</td></tr>
                {g.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{splitWhen(e.when).time}</td>
                    <td>{actorCell(e)}</td>
                    <td>{e.action}</td>
                    <td>{entityCell(e, navigate)}</td>
                    <td><button className="al-kebab" aria-label="More actions"><Icon name="more" size={14} /></button></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pt-foot">
        <span className="pt-foot-count">Showing {rows.length === 0 ? 0 : (curPage - 1) * PAGE_SIZE + 1} to {Math.min(curPage * PAGE_SIZE, rows.length)} of {rows.length} events.</span>
        <div className="al-pager">
          <button className="al-pg-btn" disabled={curPage === 1} onClick={() => setPage(curPage - 1)} aria-label="Previous page"><Icon name="back" size={14} /></button>
          {pageList(totalPages, curPage).map((p, i) =>
            p === '…'
              ? <span className="al-pg-ellipsis" key={`e${i}`}>…</span>
              : <button key={p} className={`al-pg-num ${p === curPage ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>,
          )}
          <button className="al-pg-btn" disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)} aria-label="Next page"><Icon name="chevronRight" size={14} /></button>
        </div>
      </div>
    </div>
  )
}

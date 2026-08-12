import './Profile360.css'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Card, Modal, Pill } from './ui'
import { Sparkline } from './ui/Sparkline'
import { Icon } from './ui/icons'
import type { IconName } from './ui/icons'
import type { GrievancePriority, GrievanceStatus } from '../mock/grievances'

export interface Profile360Grievance {
  id: string
  subject: string
  status: GrievanceStatus
  priority: GrievancePriority
  raisedOn: string
}

export interface Profile360KpiBreakdownRow { label: string; value: string; sub?: string }
export interface Profile360KPI {
  label: string; value: string; sub?: string; icon?: IconName; tone?: KpiTone
  /** when present, the tile becomes clickable and opens a "what makes up this number" popover */
  breakdown?: Profile360KpiBreakdownRow[]
}
export interface Profile360Section { title: string; rows: { label: string; value: string; icon?: IconName }[] }
export interface Profile360TimelineItem { title: string; note?: string; date?: string; by?: string; tone?: KpiTone }
type KpiTone = 'ai' | 'good' | 'warn' | 'crit' | 'neutral'

export interface Profile360Data {
  name: string
  color: string
  /** status pill shown next to the name (e.g. Active / Discontinued) */
  statusBadge?: ReactNode
  /** small chips under the name: type, location, partner id */
  metaChips?: { icon?: IconName; text: string }[]
  /** fallback if metaChips not supplied (legacy) */
  badges?: ReactNode
  kpis: Profile360KPI[]
  overview: string
  /** grouped detail sections — a "Business Background" one and a "Contact & Registration" one are recognised */
  details?: Profile360Section[]
  contactVerified?: boolean
  timeline?: Profile360TimelineItem[]
  trend: number[]
  docs: { name: string; status: 'verified' | 'pending' | 'not_checked' }[]
  history: string[]
  agentLog: string[]
  grievances?: Profile360Grievance[]
  onOpenGrievance?: (id: string) => void
}

const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('')
const docPill = (s: string) =>
  s === 'verified' ? <Pill tone="good" dot>Verified</Pill>
    : s === 'pending' ? <Pill tone="warn" dot>Awaiting QC</Pill>
    : <Pill tone="neutral">Not checked</Pill>
const grvStatusPill = (s: GrievanceStatus) =>
  s === 'resolved' ? <Pill tone="good" dot>Resolved</Pill>
    : s === 'in_progress' ? <Pill tone="ai" dot>In progress</Pill>
    : <Pill tone="warn" dot>Open</Pill>
const grvPriorityPill = (p: GrievancePriority) =>
  p === 'high' ? <Pill tone="crit">High</Pill>
    : p === 'medium' ? <Pill tone="warn">Medium</Pill>
    : <Pill tone="neutral">Low</Pill>

const findSection = (data: Profile360Data, needle: string) =>
  data.details?.find((s) => s.title.toLowerCase().includes(needle))

type Tab = 'overview' | 'business' | 'contact' | 'performance' | 'history' | 'documents'
const TABS: { id: Tab; label: string; ic: IconName }[] = [
  { id: 'overview', label: 'Overview', ic: 'dashboard' },
  { id: 'business', label: 'Business Details', ic: 'templates' },
  { id: 'contact', label: 'Contact & Registration', ic: 'partners' },
  { id: 'performance', label: 'Performance', ic: 'analytics' },
  { id: 'history', label: 'History & Notes', ic: 'list' },
  { id: 'documents', label: 'Documents', ic: 'documents' },
]

// A KPI tile that becomes clickable when a `breakdown` is supplied — clicking opens a modal
// showing what actually makes up the number, instead of it just sitting there unexplained.
function KpiTile({ k, showIcon, onOpen }: { k: Profile360KPI; showIcon?: boolean; onOpen: (k: Profile360KPI) => void }) {
  const clickable = !!k.breakdown?.length
  const Tag = clickable ? 'button' : 'div'
  return (
    <Tag type={clickable ? 'button' : undefined} className={`kpi ${clickable ? 'kpi-clickable' : ''}`}
      onClick={clickable ? () => onOpen(k) : undefined}>
      <div className="kpi-head">
        {showIcon && k.icon && <span className={`kpi-ic p360-tile tone-${k.tone ?? 'ai'}`}><Icon name={k.icon} size={15} /></span>}
        <span className="k-label">{k.label}</span>
      </div>
      <div className="k-value">{k.value}</div>
      {k.sub && <div className="p360-kpi-sub">{k.sub}</div>}
      {clickable && <span className="kpi-explain">What makes this up? →</span>}
    </Tag>
  )
}

function DetailGrid({ rows }: { rows: { label: string; value: string; icon?: IconName }[] }) {
  return (
    <div className="p360-details">
      {rows.map((r) => (
        <div className="p360-detail" key={r.label}>
          <div className="p360-detail-k">{r.icon && <Icon name={r.icon} size={12} />}{r.label}</div>
          <div className="p360-detail-v">{r.value}</div>
        </div>
      ))}
    </div>
  )
}

function ContactCard({ data }: { data: Profile360Data }) {
  const contact = findSection(data, 'contact')
  if (!contact) return null
  return (
    <Card>
      <div className="p360-card-head">
        <span className="p360-card-title">Contact &amp; Registration</span>
        {data.contactVerified && <Pill tone="good" dot>Verified</Pill>}
      </div>
      <DetailGrid rows={contact.rows} />
    </Card>
  )
}

function TimelineCard({ data, onViewAll }: { data: Profile360Data; onViewAll: () => void }) {
  if (!data.timeline?.length) return null
  return (
    <Card>
      <div className="p360-card-head"><span className="p360-card-title">Timeline</span></div>
      <div className="p360-timeline">
        {data.timeline.map((t, i) => (
          <div className="p360-tl-item" key={i}>
            <span className={`p360-tl-dot tone-${t.tone ?? 'neutral'}`} />
            <div className="p360-tl-body">
              <div className="p360-tl-row"><span className="p360-tl-title">{t.title}</span>{t.date && <span className="p360-tl-date">{t.date}</span>}</div>
              {t.note && <div className="p360-tl-note">{t.note}</div>}
              {t.by && <div className="p360-tl-by">{t.by}</div>}
            </div>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={onViewAll} style={{ marginTop: '0.6rem' }}>View full history</Button>
    </Card>
  )
}

function PerformanceCard({ trend }: { trend: number[] }) {
  return (
    <Card>
      <div className="p360-card-head"><span className="p360-card-title">Performance — monthly sales trend (₹L)</span></div>
      <div className="p360-perf-chart">
        <Sparkline data={trend} color="var(--ai)" width={640} height={120} responsive />
      </div>
    </Card>
  )
}

function DocumentsCard({ docs }: { docs: Profile360Data['docs'] }) {
  return (
    <Card title="Documents">
      <div className="dtable-wrap" style={{ border: 'none' }}>
        <table className="dtable"><tbody>
          {docs.map((d) => <tr key={d.name}><td className="strong">{d.name}</td><td>{docPill(d.status)}</td></tr>)}
        </tbody></table>
      </div>
    </Card>
  )
}

function GrievancesCard({ data }: { data: Profile360Data }) {
  if (!data.grievances) return null
  return (
    <Card title={`Grievances raised (${data.grievances.length})`}>
      {data.grievances.length === 0 ? (
        <p className="p360-grv-empty">No grievances on record for this distributor.</p>
      ) : (
        <div className="p360-grv">
          {data.grievances.map((g) => (
            <div key={g.id} className="p360-grv-item"
              onClick={data.onOpenGrievance ? () => data.onOpenGrievance!(g.id) : undefined}
              style={data.onOpenGrievance ? { cursor: 'pointer' } : undefined}>
              <span className="code">{g.id}</span>
              <span className="p360-grv-subj">{g.subject}</span>
              {grvPriorityPill(g.priority)}
              {grvStatusPill(g.status)}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/** Shared 360° profile — tabbed, used by Partners and the Leads distributor screen. */
export function Profile360({ data, onAskCopilot }: { data: Profile360Data; onAskCopilot?: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [openKpi, setOpenKpi] = useState<Profile360KPI | null>(null)
  const business = findSection(data, 'background')
  const contact = findSection(data, 'contact')

  return (
    <div className="p360">
      {/* Header */}
      <Card>
        <div className="p360-head">
          <span className="avatar p360-avatar" style={{ background: data.color }}>{initials(data.name)}</span>
          <div className="p360-head-main">
            <div className="p360-name-row">
              <h2>{data.name}</h2>
              {data.statusBadge}
            </div>
            <div className="p360-chips">
              {data.metaChips
                ? data.metaChips.map((c, i) => (
                    <span className="p360-chip" key={i}>{c.icon && <Icon name={c.icon} size={12} />}{c.text}</span>
                  ))
                : data.badges}
            </div>
          </div>
          {onAskCopilot && (
            <Button variant="ghost" size="sm" onClick={onAskCopilot}><Icon name="spark" size={13} /> Ask copilot</Button>
          )}
        </div>
      </Card>

      {/* KPI row */}
      <div className="kpi-grid p360-kpis">
        {data.kpis.map((k) => <KpiTile key={k.label} k={k} showIcon onOpen={setOpenKpi} />)}
      </div>

      {/* Tabs */}
      <div className="p360-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`p360-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.ic} size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="p360-cols">
          <div className="p360-col">
            <Card title="About this Partner"><p style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>{data.overview}</p></Card>
            {business && (
              <Card><div className="p360-card-head"><span className="p360-card-title">Business Background</span></div><DetailGrid rows={business.rows} /></Card>
            )}
            <PerformanceCard trend={data.trend} />
          </div>
          <div className="p360-col">
            <ContactCard data={data} />
            <TimelineCard data={data} onViewAll={() => setTab('history')} />
          </div>
        </div>
      )}

      {tab === 'business' && (
        <Card>
          <div className="p360-card-head"><span className="p360-card-title">Business Background</span></div>
          {business ? <DetailGrid rows={business.rows} /> : <p className="p360-grv-empty">No business details on record.</p>}
        </Card>
      )}

      {tab === 'contact' && (
        contact ? <ContactCard data={data} /> : <Card><p className="p360-grv-empty">No contact details on record.</p></Card>
      )}

      {tab === 'performance' && (
        <div className="p360-col">
          <PerformanceCard trend={data.trend} />
          <div className="kpi-grid p360-kpis">
            {data.kpis.map((k) => <KpiTile key={k.label} k={k} onOpen={setOpenKpi} />)}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="p360-col">
          <TimelineCard data={data} onViewAll={() => {}} />
          <Card title="Approval history">
            <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem', color: 'var(--ink-soft)', lineHeight: 1.9 }}>
              {data.history.map((h) => <li key={h}>{h}</li>)}
            </ul>
          </Card>
          <Card title="Agent activity log">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--ink-soft)' }}>
              {data.agentLog.map((a) => <div key={a}>✦ {a}</div>)}
            </div>
          </Card>
          <GrievancesCard data={data} />
        </div>
      )}

      {tab === 'documents' && (
        <div className="p360-col">
          <DocumentsCard docs={data.docs} />
          <GrievancesCard data={data} />
        </div>
      )}

      <Modal open={!!openKpi} onClose={() => setOpenKpi(null)} title={openKpi ? `${openKpi.label} — ${openKpi.value}` : ''}>
        {openKpi?.breakdown && (
          <div className="p360-kpi-breakdown">
            {openKpi.breakdown.map((r) => {
              const pctShare = r.sub && /^\d+%$/.test(r.sub) ? parseInt(r.sub, 10) : undefined
              return (
                <div className="p360-kpi-bd-row" key={r.label}>
                  <span className="p360-kpi-bd-label">{r.label}</span>
                  <span className="p360-kpi-bd-val">
                    <b>{r.value}</b>
                    {r.sub && <span className="sub">{r.sub}</span>}
                  </span>
                  {pctShare != null && <span className="p360-kpi-bd-bar"><i style={{ width: `${pctShare}%` }} /></span>}
                </div>
              )
            })}
          </div>
        )}
      </Modal>
    </div>
  )
}

import './Dashboard.css'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Modal, Pill, StreamingText } from '../components/ui'
import { Icon } from '../components/ui/icons'
import type { IconName } from '../components/ui/icons'
import { Sparkline } from '../components/ui/Sparkline'
import { DASHBOARDS } from '../mock/dashboards'
import { ROLE_BY_CODE, DEMO_USERS } from '../mock/roles'
import { memberName } from '../mock/team'
import { CANDIDATE_STAGES, isMyLead } from '../mock/candidates'
import { OWNER_ROLES } from './Approvals'
import { useApp, useMe, allowedScreens } from '../store'
import { inDataScope, inDataScopeByTown } from '../lib/dataScope'
import { workbasketStats, asesWithNoWork, assignableAses, loadByOwner } from '../lib/workbasket'
import { STATE_ORDER, START_STATE, STATE_DESC, CASE_TYPE_LABEL, TERMINAL_STATES, stateLabel } from '../lib/caseEngine'
import type { ApplicationStatus, CandidateStage, CaseRecord } from '../types'

// Deterministic mini-trend for a KPI tile (no randomness — seeded by label).
function trendFor(label: string): number[] {
  const seed = label.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const pts: number[] = []
  let v = 45
  for (let i = 0; i < 7; i++) { v += ((seed * 7 + i * 17) % 13) - 5; pts.push(Math.max(12, Math.min(88, v))) }
  return pts
}

/* ---- live SLA timers ---- */
// Mock cases carry labels like "6h left" — anchor them to page load so they tick for real.
const APP_START = Date.now()
const LEAD_SLA_MS = 48 * 3600e3 // created leads get a 48h review SLA
function slaDeadline(label: string): number | null {
  if (label === 'Overdue') return APP_START - (2 * 3600 + 13 * 60 + 40) * 1000 // counts up from ~2h14m over
  const m = label.match(/^(\d+)([hd]) left$/)
  if (!m) return null
  return APP_START + +m[1] * (m[2] === 'h' ? 3600e3 : 86400e3)
}

function SlaTimer({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const diff = deadline - now
  const over = diff < 0
  const abs = Math.abs(diff)
  const s = Math.floor(abs / 1000)
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  // Only tick the seconds when the deadline is close (within an hour either side). Far-off values
  // showing "263h 47m 43s over" are just a jittery wall of digits — a compact "11d over" is calmer
  // and easier to scan.
  const near = abs < 3600e3
  const txt = d > 0 ? `${d}d ${h}h` : h > 0 ? (near ? `${h}h ${m}m ${sec}s` : `${h}h ${m}m`) : near ? `${m}m ${sec}s` : `${m}m`
  // Bright red is reserved for cases that are genuinely actionable now — on-track or breaching
  // soon (warn), just-breached (crit). Long-overdue rows get a muted "stale" treatment so the whole
  // column doesn't scream at once.
  const tone = over ? (abs > 48 * 3600e3 ? 'stale' : 'crit') : diff < 12 * 3600e3 ? 'warn' : 'good'
  return (
    <span className={`sla-timer ${tone}`}>
      <Icon name="clock" size={11} /> {over ? `${txt} over` : `${txt} left`}
    </span>
  )
}

// "How long the case has been sitting" — compact age string (2d 3h / 5h 10m / 12m).
function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
// When the case entered the queue — earliest timeline event, else its SLA anchor, else app start.
function caseCreatedAt(c: CaseRecord): number {
  const ats = (c.events ?? []).map((e) => e.at).filter((n) => typeof n === 'number')
  if (ats.length) return Math.min(...ats)
  return c.slaAnchorAt ?? APP_START
}
// "Last updated" — the most recent real timeline event, not just when the case was opened.
function caseLastUpdatedAt(c: CaseRecord): number {
  const ats = (c.events ?? []).map((e) => e.at).filter((n) => typeof n === 'number')
  if (ats.length) return Math.max(...ats)
  return caseCreatedAt(c)
}
// Compact date+time — for the assigned/due detail folded into the Current Status cell.
function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
// Secondary description line for a lead row's "What's going on" cell — same spirit as
// nextActionForLead, just longer-form (that one's the short label, this is the detail).
function leadStageDetail(stage: CandidateStage): string {
  switch (stage) {
    case 'open': return 'Field visit and infrastructure rating still pending.'
    case 'pending': return 'Ready to submit — fill in the recommendation form from New Application.'
    case 'approval_1': return 'With Finance / Channel Development for the first evaluation.'
    case 'approval_2': return 'Both evaluations cleared — awaiting Leadership sign-off.'
    case 'rejected': return 'Closed — not proceeding.'
    default: return 'In progress.'
  }
}

// Colour per lead stage in the pipeline breadcrumb — so "Open"/"Pending"/"Approval 1"/etc. each
// read as their own distinct chip instead of a wall of identically-styled text.
type StageTone = 'neutral' | 'warn' | 'ai' | 'good'
const STAGE_TONE: Record<string, StageTone> = {
  open: 'neutral', pending: 'neutral', approval_1: 'warn', approval_2: 'ai', active: 'good',
}
// The pipeline breadcrumb uses the app's own lead-stage vocabulary (Open/Pending/Approval 1/
// Approval 2/Active — see CANDIDATE_STAGES) for BOTH leads and cases, not the case workflow
// engine's internal state names (Submitted/Under Review/...) — a case's current state maps onto
// the equivalent point in that same lead journey, so one breadcrumb genuinely covers both row
// types instead of only ever counting cases (leads always showed 0 before this).
const CASE_STATE_TO_LEAD_STAGE: Record<string, CandidateStage> = {
  SUBMITTED: 'open', UNDER_REVIEW: 'approval_1', LEADERSHIP_SIGNOFF: 'approval_2', ACTIVE: 'active',
  REJECTED: 'rejected', CANCELLED: 'rejected',
}

const CASE_STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'crit' | 'neutral' }> = {
  auto_cleared: { label: 'Auto-cleared', tone: 'good' },
  flagged: { label: 'Flagged', tone: 'crit' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'crit' },
  draft: { label: 'Draft', tone: 'neutral' },
}

// The concrete next step for a case/lead — what "Recent cases" showed only as a status pill
// before, spelled out as an action so the row answers "what do I actually do about this."
function nextActionForCase(c: CaseRecord): string {
  if (c.status === 'rejected') return 'Closed — rejected'
  if (c.status === 'approved' && c.ownerRole !== 'leadership') return 'Cleared here — awaiting sibling evaluation'
  if (c.status === 'approved') return 'Active — with IT for DB Code'
  if (c.status === 'auto_cleared') return 'Active — with IT for DB Code'
  if (c.status === 'flagged') {
    if (c.ownerRole === 'leadership') return 'Awaiting Leadership sign-off'
    return `Awaiting ${c.ownerRole === 'finance' ? 'Finance' : c.ownerRole === 'channel_dev' ? 'Trade Marketing' : 'MDM'} review`
  }
  return 'Awaiting submission'
}
function nextActionForLead(stage: string): string {
  switch (stage) {
    case 'open': return 'Needs field visit & infra rating'
    case 'pending': return 'Ready to submit in New Application'
    case 'approval_1': return 'Awaiting Finance/Channel review'
    case 'approval_2': return 'Awaiting Leadership sign-off'
    case 'rejected': return 'Closed — rejected'
    default: return 'In progress'
  }
}

/* ---------------- Stage breadcrumb — "where is this, exactly" ---------------- */
// One shape for both a lead's stage (open/pending/approval_1/approval_2/active/rejected) and a
// case's workflow state (submitted/under review/leadership sign-off/active) — driven by the SAME
// real ladders the rest of the app already decides against (CANDIDATE_STAGES, caseEngine's
// STATE_ORDER), so this can never show a stage that contradicts what Leads/Approvals show.
interface Breadcrumb { steps: { key: string; label: string }[]; currentIdx: number; rejected?: string }
const LEAD_LADDER: CandidateStage[] = ['open', 'pending', 'approval_1', 'approval_2', 'active']
function breadcrumbForLead(stage: CandidateStage): Breadcrumb {
  const steps = LEAD_LADDER.map((id) => ({ key: id, label: CANDIDATE_STAGES.find((s) => s.id === id)?.label ?? id }))
  if (stage === 'rejected') return { steps, currentIdx: -1, rejected: 'Rejected' }
  return { steps, currentIdx: LEAD_LADDER.indexOf(stage) }
}
function breadcrumbForCase(c: CaseRecord): Breadcrumb {
  const type = c.caseType ?? 'appointment'
  const ladder = STATE_ORDER[type] ?? []
  const current = c.caseState ?? START_STATE[type] ?? ''
  const steps = ladder.map((id) => ({ key: id, label: stateLabel(id) }))
  if (current === 'REJECTED' || current === 'CANCELLED') return { steps, currentIdx: -1, rejected: stateLabel(current) }
  return { steps, currentIdx: ladder.indexOf(current) }
}

function StageBreadcrumb({ b, compact }: { b: Breadcrumb; compact?: boolean }) {
  return (
    <div className={`stage-crumb ${compact ? 'compact' : ''}`}>
      {b.steps.map((s, i) => (
        <span key={s.key} className={`sc-step ${i < b.currentIdx ? 'done' : ''} ${i === b.currentIdx && !b.rejected ? 'now' : ''}`}>
          {i > 0 && <span className="sc-sep">›</span>}
          <span className="sc-label">{s.label}</span>
        </span>
      ))}
      {b.rejected && <span className="sc-step now off"><span className="sc-sep">›</span><span className="sc-label">{b.rejected}</span></span>}
    </div>
  )
}

const SUBTYPE_LABEL: Record<string, string> = { new: 'New DB', replacement: 'Replacement DB', additional: 'Additional DB' }
const SUBTYPE_SHORT: Record<string, string> = { new: 'New', replacement: 'Replacement', additional: 'Additional' }

/* ---------------- Case-health donut ---------------- */
function Donut({ segments, total, size = 150, thickness = 20 }:
  { segments: { label: string; value: number; color: string }[]; total: number; size?: number; thickness?: number }) {
  const r = (size - thickness) / 2
  const cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  let acc = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut" role="img" aria-label={`${total} total cases`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {segments.filter((s) => s.value > 0).map((s) => {
          const frac = total ? s.value / total : 0
          const len = frac * circ
          const seg = (
            <circle key={s.label} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc} />
          )
          acc += len
          return seg
        })}
      </g>
      <text x={cx} y={cy - 2} textAnchor="middle" className="donut-total">{total}</text>
      <text x={cx} y={cy + 15} textAnchor="middle" className="donut-sub">Total cases</text>
    </svg>
  )
}

interface RcRow {
  key: string; id: string; title: string; sub: string
  type: string; typeClass: string
  status: { label: string; tone: 'good' | 'warn' | 'crit' | 'neutral' }
  withLabel: string; withSub?: string; value: string; age: string
  conf: number; sla: ReactNode; nextAction: string; overdue: boolean; stage: Breadcrumb
  // Secondary line under nextAction in the "What's going on" column — the real flag reason for
  // a case, a per-stage blurb for a lead. Undefined when there's nothing more to say.
  detailLine?: string
  lastUpdatedMs: number
  // Which pipeline-summary stage this row belongs to (a CandidateStage id, or 'REJECTED') — set
  // on both lead and case rows (a case's stage is mapped via CASE_STATE_TO_LEAD_STAGE), so the
  // breadcrumb's stage buttons filter across both row types, not just cases.
  stageKey?: string
  onView: () => void; viewLabel: string
  // full case-level picture, revealed when the row is clicked (opens the detail modal)
  detail: { fields: { label: string; value: string }[]; note?: string }
  // raw, sortable values behind the formatted strings above — age/value/SLA/confidence
  ageMs: number; valueNum: number; slaMs: number | null
}
const ROWS_PER_PAGE = 6

export function Dashboard() {
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const me = useMe()
  const role = ROLE_BY_CODE[viewingAs]
  const dash = DASHBOARDS[viewingAs]
  const navigate = useNavigate()
  const askCopilot = useApp((s) => s.askCopilot)
  const addReport = useApp((s) => s.addReport)
  const logAudit = useApp((s) => s.logAudit)
  const moduleAccess = useApp((s) => s.moduleAccess)
  // Role ceiling narrowed by this person's own View toggle — same rule Shell.tsx's sidebar uses,
  // so a screen this dashboard routes to is never one the sidebar itself has hidden for them.
  const canSeeApprovals = allowedScreens(moduleAccess[viewingAs] ?? [], me).includes('/approvals')
  // Same queue Approvals reads — includes cases the New Application wizard raises live, not
  // just the seeded demo set.
  const allCases = useApp((s) => s.flaggedCases)
  // IT's queue lives on OnboardingCase, not CaseRecord — flaggedCases never carries anything
  // owned by 'it', so its work has to be surfaced separately (below) instead of via recentCases.
  const onboardingCases = useApp((s) => s.onboardingCases)
  const partners = useApp((s) => s.partners)
  const createDbCode = useApp((s) => s.createDbCode)
  const dbCodeQueue = onboardingCases
    .filter((o) => o.caseState === 'APPOINTMENT')
    .map((o) => ({ ob: o, partner: o.partnerId ? partners.find((p) => p.id === o.partnerId) : undefined }))
    .filter((x) => !x.partner?.dbCode)
  const workbasket = useApp((s) => s.workbasket)
  const availabilityByUser = useApp((s) => s.availabilityByUser)
  const dataScopeByRole = useApp((s) => s.dataScopeByRole)
  const dataEntitiesByRole = useApp((s) => s.dataEntitiesByRole)
  // Data-level RBAC: a scoped persona (set by the Super Admin in Admin > Data access) only sees
  // cases/leads in their own region/state on the dashboard — if "Dashboard" is checked as one
  // of the screens that scope applies to for this persona.
  const myScope = dataScopeByRole[viewingAs]
  const myRegion = DEMO_USERS[viewingAs]?.region
  const myState = DEMO_USERS[viewingAs]?.state
  const scopesDashboard = (dataEntitiesByRole[viewingAs] ?? []).includes('dashboard')
  const isRegionScoped = myScope !== 'all' && scopesDashboard
  // Owner-role personas (Finance/Channel Development/MDM) only see cases actually theirs to act on.
  // MDM review isn't a current priority — keep MDM-owned cases out of everyone else's queue view
  // (MDM's own dashboard is unaffected, since it's already scoped to ownerRole === 'mdm' below).
  const ownerScoped = OWNER_ROLES.includes(viewingAs)
    ? allCases.filter((c) => c.ownerRole === viewingAs)
    : allCases.filter((c) => c.ownerRole !== 'mdm')
  const recentCases = isRegionScoped ? ownerScoped.filter((c) => inDataScope(c.state, myScope, myRegion, myState)) : ownerScoped
  // Prospecting leads aren't Finance's, MDM's, or Leadership's concern — they only see a case once
  // it's flagged to them. Leadership also has no /leads module access.
  const showLeadRows = viewingAs !== 'finance' && viewingAs !== 'mdm' && viewingAs !== 'leadership'

  const candidates = useApp((s) => s.candidates)
  const ownLeads = candidates.filter((c) => c.userCreated && (viewingAs !== 'ase_asm' || isMyLead(c, me?.id, viewingAs)))
  const myLeads = isRegionScoped ? ownLeads.filter((c) => inDataScopeByTown(c.town, myScope, myRegion, myState)) : ownLeads

  const [detailModal, setDetailModal] = useState<RcRow | null>(null)
  // Clicking a pipeline-summary stage narrows the table to cases sitting in that stage — the
  // one filter that reuses the breadcrumb itself instead of a separate dropdown.
  const [stageFilter, setStageFilter] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  /* ---- KPIs, donut and trend all derive from the SAME case set, so the numbers always agree ---- */
  const cnt = (s: ApplicationStatus) => recentCases.filter((c) => c.status === s).length
  const total = recentCases.length
  const overSla = recentCases.filter((c) => c.isOverdue).length
  const flaggedN = cnt('flagged')
  const pendingN = cnt('flagged') + cnt('draft')
  const autoN = cnt('auto_cleared')
  const resTime = dash.kpis.find((k) => /time|resolution/i.test(k.label))?.value ?? '1.8d'

  // Every KPI tile is a shortcut into the view that explains it — the case queue for the counts,
  // Analytics for the resolution-time trend.
  const queueRoute = canSeeApprovals ? '/approvals' : '/leads'
  const kpis: { label: string; value: string; sub: string; icon: IconName; color: string; delta: string; deltaGood: boolean; route: string; alert?: boolean }[] = [
    { label: 'Assigned cases', value: String(total), sub: 'in your queue', icon: 'leads', color: 'var(--chart-1)', delta: '↑ 3 today', deltaGood: true, route: queueRoute },
    { label: 'Pending review', value: String(pendingN), sub: 'cases', icon: 'approvals', color: 'var(--chart-2)', delta: '↓ 2', deltaGood: true, route: queueRoute },
    { label: 'Over SLA', value: String(overSla), sub: 'cases', icon: 'clock', color: 'var(--crit)', delta: '↓ 1', deltaGood: true, route: queueRoute, alert: overSla > 0 },
    { label: 'Flagged', value: String(flaggedN), sub: 'urgent', icon: 'flag', color: 'var(--crit)', delta: '↑ 1', deltaGood: false, route: queueRoute, alert: flaggedN > 0 },
    { label: 'Auto-cleared', value: String(autoN), sub: 'cases', icon: 'check', color: 'var(--good)', delta: '↑ 5 today', deltaGood: true, route: queueRoute },
    { label: 'Avg. resolution time', value: resTime, sub: 'vs last month', icon: 'target', color: 'var(--ai)', delta: '↓ 12%', deltaGood: true, route: '/analytics' },
  ]
  // IT's real queue is onboarding cases awaiting a DB Code, not flaggedCases (always empty for
  // this persona) — swap in KPIs that mean something instead of a row of zeros.
  if (viewingAs === 'it') {
    kpis.splice(0, kpis.length,
      { label: 'Awaiting DB Code', value: String(dbCodeQueue.length), sub: 'onboarding cases', icon: 'monitor', color: 'var(--crit)', delta: dbCodeQueue.length ? '↑ needs action' : '— steady', deltaGood: dbCodeQueue.length === 0, route: '/approvals', alert: dbCodeQueue.length > 0 },
      { label: 'Completed', value: String(onboardingCases.filter((o) => o.caseState === 'COMPLETE').length), sub: 'DB Codes created', icon: 'check', color: 'var(--good)', delta: '— steady', deltaGood: true, route: '/approvals' },
    )
  }

  /* ---- Recent-cases rows (leads + cases), normalised to one shape so we can paginate uniformly ---- */
  const leadRows: RcRow[] = (showLeadRows ? myLeads : []).map((l) => {
    const leadDeadline = (l.createdAt ?? APP_START) + LEAD_SLA_MS
    return {
      key: l.id,
      id: `LD-${l.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase()}`,
      title: l.name, sub: `${l.town} · ${l.dbCategory}`,
      type: l.subtype ? SUBTYPE_SHORT[l.subtype] ?? l.subtype : 'New',
      typeClass: l.subtype ?? 'new',
      status: { label: CANDIDATE_STAGES.find((s) => s.id === l.stage)?.label ?? l.stage, tone: l.stage === 'rejected' ? 'crit' : 'warn' },
      withLabel: ROLE_BY_CODE[l.createdBy ?? 'ase_asm']?.label ?? 'ASE',
      value: l.expectedRcplTurnover != null ? `₹${l.expectedRcplTurnover}L/mo` : '—',
      age: formatAge(l.createdAt ?? APP_START),
      conf: l.confidencePct,
      sla: <SlaTimer deadline={leadDeadline} />,
      nextAction: nextActionForLead(l.stage),
      detailLine: leadStageDetail(l.stage),
      lastUpdatedMs: l.createdAt ?? APP_START,
      stage: breadcrumbForLead(l.stage),
      stageKey: l.stage === 'rejected' ? 'REJECTED' : l.stage,
      overdue: Date.now() > leadDeadline && l.stage !== 'active' && l.stage !== 'rejected',
      ageMs: l.createdAt ?? APP_START, valueNum: l.expectedRcplTurnover ?? 0, slaMs: leadDeadline,
      onView: () => navigate('/leads', { state: { openLeadId: l.id } }), viewLabel: 'View lead',
      detail: {
        fields: [
          { label: 'Location', value: l.town },
          { label: 'DB category', value: l.dbCategory },
          { label: 'Type', value: l.subtype ? SUBTYPE_LABEL[l.subtype] ?? l.subtype : 'New DB' },
          { label: 'Expected RCPL turnover', value: `₹${l.expectedRcplTurnover}L/mo` },
          { label: 'Total firm turnover', value: `₹${l.turnoverMonthly}L/mo` },
          { label: 'Coverage', value: `${l.coverageOutlets} outlets` },
          { label: 'Infra score', value: `${l.infraScore}/10` },
          { label: 'Finance readiness', value: `${l.finEvalPct}%` },
          { label: 'AI confidence', value: `${l.confidencePct}%` },
        ],
      },
    }
  })
  const caseRows: RcRow[] = recentCases.map((c) => {
    const st = CASE_STATUS[c.status]
    const deadline = slaDeadline(c.slaLabel)
    const partnerTypeLabel = c.partnerType === 'vendor' ? 'Vendor / Service Partner' : 'GT DB (with CSO/DSM)'
    return {
      key: c.code, id: c.code, title: c.partnerName,
      sub: `${c.town}, ${c.state}`,
      type: SUBTYPE_SHORT[c.subtype] ?? c.subtype,
      typeClass: c.subtype,
      status: st, withLabel: ROLE_BY_CODE[c.ownerRole]?.label ?? c.ownerRole,
      withSub: c.assigneeId ? memberName(c.assigneeId) : undefined,
      value: c.expectedTurnover != null ? `₹${c.expectedTurnover}L/mo` : '—',
      age: formatAge(caseCreatedAt(c)),
      conf: c.confidencePct,
      sla: deadline != null ? <SlaTimer deadline={deadline} /> : <span className="rc-muted">—</span>,
      nextAction: nextActionForCase(c),
      detailLine: c.flagDetail ?? STATE_DESC[c.caseState ?? START_STATE[c.caseType ?? 'appointment'] ?? ''],
      lastUpdatedMs: caseLastUpdatedAt(c),
      stage: breadcrumbForCase(c),
      stageKey: (() => {
        const mapped = CASE_STATE_TO_LEAD_STAGE[c.caseState ?? START_STATE[c.caseType ?? 'appointment'] ?? '']
        return c.status === 'rejected' || mapped === 'rejected' ? 'REJECTED' : (mapped ?? 'open')
      })(),
      overdue: c.status === 'flagged' && (c.isOverdue || (deadline != null && Date.now() > deadline)),
      ageMs: caseCreatedAt(c), valueNum: c.expectedTurnover ?? 0, slaMs: deadline,
      onView: () => canSeeApprovals ? navigate('/approvals', { state: { openCode: c.code } }) : navigate('/partners'),
      viewLabel: 'View case',
      detail: {
        fields: [
          { label: 'Location', value: `${c.town}, ${c.state}` },
          { label: 'DB type', value: SUBTYPE_LABEL[c.subtype] ?? c.subtype },
          { label: 'Partner type', value: partnerTypeLabel },
          { label: 'Expected turnover', value: c.expectedTurnover != null ? `₹${c.expectedTurnover}L/mo` : '—' },
          { label: 'Currently with', value: `${ROLE_BY_CODE[c.ownerRole]?.label ?? c.ownerRole}${c.assigneeId ? ` · ${memberName(c.assigneeId)}` : ''}` },
          { label: 'Final sign-off', value: c.signoffAuthority ?? 'SM' },
          { label: 'AI confidence', value: `${c.confidencePct}%` },
          { label: 'SLA', value: c.isOverdue ? 'Overdue' : c.slaLabel },
        ],
        note: c.status === 'flagged' ? c.flagDetail : undefined,
      },
    }
  })
  const allRows = [...leadRows, ...caseRows]
  // Pipeline summary — ONE aggregate breadcrumb for the whole queue, pinned once at the top of
  // the card instead of repeating a full breadcrumb on every single row. Uses the app's own
  // lead-stage vocabulary (Open/Pending/Approval 1/Approval 2/Active) so it counts BOTH leads and
  // cases (via stageKey, mapped for cases — see CASE_STATE_TO_LEAD_STAGE), not just cases.
  const pipelineStages = CANDIDATE_STAGES.filter((s) => s.id !== 'rejected').map((s) => ({
    key: s.id, label: s.label, tone: STAGE_TONE[s.id] ?? 'neutral',
    count: allRows.filter((r) => r.stageKey === s.id).length,
  }))
  const rejectedCount = allRows.filter((r) => r.stageKey === 'REJECTED').length
  // "Overdue Tasks" mini-list, back beside Cases by Stage — the most urgent rows, soonest/
  // most-overdue deadline first.
  const overdueRows = allRows.filter((r) => r.overdue).slice().sort((a, b) => (a.slaMs ?? Infinity) - (b.slaMs ?? Infinity))
  const overdueCount = overdueRows.length
  // "Active Process" / "Process Stages" focus on ONE case — the single most urgent still-open
  // one (soonest deadline among flagged cases), since this dashboard is a queue, not a
  // single-case workspace. Falls back to any open case, and hides the section if there's none.
  const focusCase = (() => {
    const flaggedWithDeadline = recentCases
      .filter((c) => c.status === 'flagged')
      .map((c) => ({ c, deadline: slaDeadline(c.slaLabel) }))
      .sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity))
    return flaggedWithDeadline[0]?.c ?? recentCases[0]
  })()

  // The only queue filter now is the pipeline breadcrumb's stage chips — no separate Type/SLA
  // dropdowns or overdue toggle, since those just duplicated what the breadcrumb already does.
  const rows = allRows
    .filter((r) => !stageFilter || r.stageKey === stageFilter)
    .slice()
    .sort((a, b) => (a.slaMs ?? Infinity) - (b.slaMs ?? Infinity)) // soonest/most urgent first
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE))
  const curPage = Math.min(page, pageCount)
  const pageRows = rows.slice((curPage - 1) * ROWS_PER_PAGE, curPage * ROWS_PER_PAGE)

  const exportView = () => {
    addReport({ name: `${role.label} dashboard snapshot`, format: 'PDF' })
    logAudit({ actor: 'You', kind: 'human', action: 'Exported dashboard snapshot to Reports', entity: 'Dashboard' })
    navigate('/reports')
  }

  return (
    <div>
      <div className="page-head">
        <div className="row-between">
          <div>
            <h1>{role.label} dashboard <span className="page-info-ic" title={role.blurb}><Icon name="help" size={13} /></span></h1>
          </div>
          <div className="dash-head-actions">
            <Button variant="ghost" size="sm" onClick={exportView}>
              <Icon name="download" size={14} /> Export / Share <Icon name="chevronDown" size={12} />
            </Button>
            {viewingAs === 'ase_asm' && (
              <Button size="sm" onClick={() => navigate('/intake-inbox', { state: { openCreateLead: true } })}>
                <Icon name="new" size={14} /> Create Lead
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Two-column layout: everything queue-related on the left, the process/journey rail
          pinned on the right (sticky) so it stays visible while the table scrolls. */}
      <div className="dash-layout">
      <div className="dash-main">
      {/* AI insight banner */}
      <div className="dash-insight">
        <span className="di-ic"><Icon name="spark" size={18} /></span>
        <div className="di-body">
          <div className="di-tag">AI Insight</div>
          {/* key forces the stream to replay when persona changes */}
          <div className="di-text"><StreamingText key={viewingAs} text={dash.insight} speed={14} /></div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => askCopilot('Catch me up on today')}>View full insight →</Button>
      </div>

      {/* KPI row — case-centric, all six derived from the same queue */}
      <div className={`kpi-grid ${viewingAs === 'it' ? '' : 'kpi-6'}`}>
        {kpis.map((k) => (
          <div key={k.label} className={`kpi clickable ${k.alert ? 'kpi-alert' : ''}`}
            role="button" tabIndex={0}
            onClick={() => navigate(k.route)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(k.route) } }}
            title={`Open ${k.label.toLowerCase()}`}>
            <div className="kpi-head">
              <span className="kpi-ic" style={{ background: `color-mix(in srgb, ${k.color} 14%, transparent)`, color: k.color }}>
                <Icon name={k.icon} size={14} />
              </span>
              <span className="k-label">{k.label}</span>
            </div>
            <div className="k-value">{k.value}</div>
            <div className="k-sub">{k.sub}</div>
            <div className="kpi-foot">
              <span className={`k-delta ${k.deltaGood ? 'good' : 'bad'}`}>{k.delta}</span>
              <Sparkline data={trendFor(k.label)} color={k.color} width={70} height={28} />
            </div>
          </div>
        ))}
      </div>

      {/* Cases by Stage · Overdue Tasks — side by side. "My Cases by Status" stays dropped (the
          pipeline breadcrumb up in Recent cases already covers that ground), but Overdue Tasks
          is back next to Cases by Stage. */}
      <div className="dash-mid2">
        <Card>
          <div className="chart-head"><span className="card-title" style={{ margin: 0 }}>Cases by Stage</span></div>
          {total === 0 ? (
            <div className="chart-empty">No cases in your queue right now.</div>
          ) : (() => {
            const stageSegments = [
              ...pipelineStages.map((s, i) => ({ label: s.label, value: s.count, color: `var(--chart-${(i % 5) + 1})` })),
              ...(rejectedCount > 0 ? [{ label: 'Rejected', value: rejectedCount, color: 'var(--ink-mute)' }] : []),
            ]
            return (
              <div className="health-body">
                <Donut segments={stageSegments} total={total} size={110} thickness={16} />
                <ul className="health-legend">
                  {stageSegments.map((s) => (
                    <li key={s.label}>
                      <span className="hl-dot" style={{ background: s.color }} />
                      <span className="hl-label">{s.label}</span>
                      <span className="hl-val">{s.value} <span className="hl-pct">({total ? Math.round((s.value / total) * 100) : 0}%)</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}
        </Card>

        <Card>
          <div className="chart-head"><span className="card-title" style={{ margin: 0 }}>Overdue Tasks</span></div>
          {overdueRows.length === 0 ? (
            <div className="chart-empty">Nothing overdue right now.</div>
          ) : (
            <>
              <ul className="overdue-mini-list">
                {overdueRows.slice(0, 3).map((r) => (
                  <li key={r.key} onClick={() => setDetailModal(r)}>
                    <div className="oml-main">
                      <span className="oml-title">{r.title}</span>
                      <span className="oml-sub">{r.id} · {r.nextAction}</span>
                    </div>
                    <div className="oml-side">{r.sla}</div>
                  </li>
                ))}
              </ul>
              <div className="status-bar-total"><span>Total Overdue Tasks</span><b>{overdueCount}</b></div>
            </>
          )}
        </Card>
      </div>

      {/* ASM / RBL — a team-oversight panel: DB-pool health, which ASEs are idle / on leave, each
          ASE's load, and one-click into the assign view. Distribution is their call. */}
      {(viewingAs === 'rbl' || viewingAs === 'asm') && (() => {
        const stats = workbasketStats(workbasket)
        const ases = assignableAses()
        const load = loadByOwner(workbasket)
        const idle = new Set(asesWithNoWork(workbasket).map((m) => m.id))
        const onLeaveCount = ases.filter((m) => (availabilityByUser[m.id]?.status ?? m.availability.status) === 'on_leave').length
        const tiles = [
          { v: stats.unclaimed, l: 'Unassigned DBs', alert: stats.unclaimed > 0 },
          { v: idle.size, l: 'ASEs idle', alert: idle.size > 0 },
          { v: onLeaveCount, l: 'ASEs on leave', alert: onLeaveCount > 0 },
          { v: stats.flagged, l: 'Flagged', alert: stats.flagged > 0 },
        ]
        return (
          <div style={{ marginBottom: '1rem' }}>
            <Card title="Team &amp; DB Pool oversight">
              <div className="wb-widget">
                <div className="wb-widget-row">
                  {tiles.map((t) => (
                    <div key={t.l} className={`wb-widget-tile ${t.alert ? 'alert' : ''}`}>
                      <div className="v">{t.v}</div><div className="l">{t.l}</div>
                    </div>
                  ))}
                </div>
                <div className="sup-team">
                  {ases.map((m) => {
                    const leave = (availabilityByUser[m.id]?.status ?? m.availability.status) === 'on_leave'
                    return (
                      <div className={`sup-asm ${idle.has(m.id) ? 'idle' : ''}`} key={m.id}>
                        <span className="sup-asm-name">{m.name}</span>
                        <span className="sup-asm-load"><b>{load[m.id] ?? 0}</b> DBs</span>
                        {leave ? <Pill tone="crit" dot>On leave</Pill> : idle.has(m.id) ? <Pill tone="warn" dot>Idle</Pill> : <Pill tone="good" dot>Active</Pill>}
                      </div>
                    )
                  })}
                </div>
                <div className="sup-actions">
                  <Button size="sm" onClick={() => navigate('/leads')}><Icon name="leads" size={13} /> Assign DBs to ASEs</Button>
                  {viewingAs === 'rbl' && <Button variant="ghost" size="sm" onClick={() => navigate('/team')}><Icon name="user" size={13} /> Team &amp; availability</Button>}
                  <Button variant="ghost" size="sm" onClick={() => navigate('/approvals')}><Icon name="approvals" size={13} /> Approvals</Button>
                </div>
              </div>
            </Card>
          </div>
        )
      })()}

      {/* IT — the whole job is creating the DB Code for a DB the instant it clears final sign-off,
          so it's surfaced right here on the dashboard rather than buried in Approvals' Onboarding
          tab (recentCases/allRows are always empty for IT — see dbCodeQueue above). */}
      {viewingAs === 'it' && (
        <div style={{ marginBottom: '1rem' }}>
          <Card title="DB Codes to create">
            {dbCodeQueue.length === 0 ? (
              <div className="chart-empty">Nothing awaiting a DB Code right now.</div>
            ) : (
              <ul className="overdue-mini-list">
                {dbCodeQueue.map(({ ob }) => (
                  <li key={ob.id}>
                    <div className="oml-main">
                      <span className="oml-title">{ob.partnerName}</span>
                      <span className="oml-sub">{ob.code} · {ob.town}, {ob.state}{ob.parentCaseCode ? ` · from ${ob.parentCaseCode}` : ''}</span>
                    </div>
                    <div className="oml-side" style={{ display: 'flex', gap: '0.5rem' }}>
                      <Button variant="ghost" size="sm" onClick={() => navigate('/approvals', { state: { openOnboardingId: ob.id } })}>View</Button>
                      <Button size="sm" onClick={() => createDbCode(ob.id, me?.name ?? 'You')}>
                        <Icon name="monitor" size={13} /> Create DB Code
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Recent cases — the work queue, one row per case/lead assigned to me, paginated with
          a per-row action. There's no separate sub-task breakdown in the data model, so each row
          IS the task: its current workflow stage stands in for "what to do next". */}
      <Card>
        <div className="rc-head">
          <span className="card-title">Recent cases ({allRows.length})</span>
          {/* One aggregate stage breadcrumb for the whole queue, pinned here once instead of
              repeating a trail on every row. Each stage is itself a filter — click one to narrow
              the table to cases sitting there right now (click again, or Clear filters, to reset).
              Leads have no equivalent stage here, so selecting one narrows to cases only. The
              overdue count lives here too, as its own toggle, instead of a separate chip below. */}
          {recentCases.length > 0 && (
            <div className="rc-pipeline" title="Click a stage to filter the queue to it">
              {pipelineStages.map((s, i) => (
                <span className="rp-chip-wrap" key={s.key}>
                  <button type="button" className={`rp-chip tone-${s.tone} ${stageFilter === s.key ? 'active' : ''}`}
                    onClick={() => { setStageFilter(stageFilter === s.key ? null : s.key); setPage(1) }}>
                    <span className="rp-chip-dot" /><b>{s.count}</b> {s.label}
                  </button>
                  {(i < pipelineStages.length - 1 || rejectedCount > 0) && <span className="rp-sep"><Icon name="chevronRight" size={12} /></span>}
                </span>
              ))}
              {rejectedCount > 0 && (
                <span className="rp-chip-wrap">
                  <button type="button" className={`rp-chip tone-crit ${stageFilter === 'REJECTED' ? 'active' : ''}`}
                    onClick={() => { setStageFilter(stageFilter === 'REJECTED' ? null : 'REJECTED'); setPage(1) }}>
                    <span className="rp-chip-dot" /><b>{rejectedCount}</b> Rejected
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
        <div className="dtable-wrap">
          <table className="dtable rc-table">
            <thead>
              <tr>
                <th>Distributor</th><th>Case ID</th><th>Case Type</th><th>Current Status</th><th>SLA</th><th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={6} className="rc-empty">
                  {allRows.length === 0 ? 'No cases in your queue right now.' : 'No cases match these filters.'}
                </td></tr>
              )}
              {pageRows.map((r) => (
                <tr key={r.key} className="rc-row" onClick={() => setDetailModal(r)}>
                  <td className="strong">{r.title}<div className="cell-sub">{r.sub}</div></td>
                  <td className="strong">{r.id}</td>
                  <td><span className={`rc-type ${r.typeClass}`}>{r.type}</span></td>
                  {/* "Current Status" answers who/what it's stuck with — the specific person when
                      one's assigned (not just their role), plus when it was assigned and when
                      it's due, so nothing from the old columns is actually lost, just folded in. */}
                  <td>
                    <Pill tone={r.status.tone} dot>{r.nextAction}</Pill>
                    <div className="cell-sub rc-status-meta">
                      With {r.withSub ?? r.withLabel} · Assigned {formatDateTime(r.ageMs)}
                      {r.slaMs != null && <> · Due {formatDateTime(r.slaMs)}</>}
                    </div>
                  </td>
                  <td>{r.sla}</td>
                  <td>
                    <div className="rc-action">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDetailModal(r) }}>Open</Button>
                      <button className="kebab" aria-label="More actions" title="More actions" onClick={(e) => e.stopPropagation()}><Icon name="more" size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rc-foot">
          <span className="rc-count">
            Showing {rows.length ? (curPage - 1) * ROWS_PER_PAGE + 1 : 0} to {Math.min(curPage * ROWS_PER_PAGE, rows.length)} of {rows.length} cases
          </span>
          <div className="rc-pager">
            <button className="pg" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} aria-label="Previous page"><Icon name="chevronRight" size={13} /></button>
            {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map((p) => (
              <button key={p} className={`pg ${p === curPage ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button className="pg" disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)} aria-label="Next page"><Icon name="chevronRight" size={13} /></button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate(canSeeApprovals ? '/approvals' : '/leads')}>View all cases →</Button>
        </div>
      </Card>
      </div>

      {/* Right rail: Active Process + Process Stages (for the single most urgent open case —
          this dashboard is a queue, not a single-case workspace, so it can't show every case's
          process at once), plus Quick Links. */}
      <div className="dash-side">
        {focusCase && (() => {
          const type = focusCase.caseType ?? 'appointment'
          const ladder = STATE_ORDER[type] ?? []
          const current = focusCase.caseState ?? START_STATE[type] ?? ''
          const currentIdx = ladder.indexOf(current)
          const isTerminal = TERMINAL_STATES.has(current)
          return (
            <>
              <Card title="Active Process">
                <div className="proc-focus-name">{focusCase.partnerName}</div>
                <div className="proc-focus-sub">
                  {focusCase.code} · {CASE_TYPE_LABEL[type]}
                  {!isTerminal && ladder.length > 0 && ` — stage ${Math.max(0, currentIdx) + 1} of ${ladder.length}`}
                </div>
                <div className="proc-mini-flow">
                  {ladder.map((st, i) => (
                    <span key={st} className={`pmf-dot ${i < currentIdx ? 'done' : ''} ${st === current ? 'now' : ''}`} title={stateLabel(st)} />
                  ))}
                </div>
                {canSeeApprovals && (
                  <Button variant="ghost" size="sm" onClick={() => navigate('/approvals', { state: { openCode: focusCase.code } })}>View Process →</Button>
                )}
              </Card>

              <div className="upnext urgent">
                <div className="rail-title"><Icon name="flag" size={12} /> Urgent</div>
                <div className="un-body">{dash.upNext.lead} <b>{dash.upNext.detail}</b></div>
                <Button size="sm" onClick={() => navigate(dash.upNext.route)}>{dash.upNext.cta} →</Button>
              </div>

              <Card title="Process Stages">
                <ul className="proc-stage-list">
                  {ladder.map((st, i) => (
                    <li key={st} className={i < currentIdx ? 'done' : st === current ? 'current' : 'pending'} title={STATE_DESC[st] ?? stateLabel(st)}>
                      <span className="psl-dot">{i < currentIdx ? <Icon name="check" size={10} /> : ''}</span>
                      <span className="psl-label">{stateLabel(st)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )
        })()}

        <Card title="Quick Links">
          <ul className="quick-links">
            {viewingAs === 'ase_asm' && (
              <li><button onClick={() => navigate('/intake-inbox', { state: { openCreateLead: true } })}><Icon name="new" size={13} /> Create Lead</button></li>
            )}
            <li><button onClick={() => navigate(canSeeApprovals ? '/approvals' : '/leads')}><Icon name="approvals" size={13} /> {canSeeApprovals ? 'Approvals' : 'Leads'}</button></li>
            <li><button onClick={() => navigate('/reports')}><Icon name="documents" size={13} /> Reports</button></li>
            <li><button onClick={() => navigate('/my-settings')}><Icon name="settings" size={13} /> My Settings</button></li>
          </ul>
        </Card>
      </div>
      </div>

      {/* Case detail — the full case-level picture, opened by clicking a row (stays on the dashboard) */}
      <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title={detailModal ? `${detailModal.id} · ${detailModal.title}` : 'Case'}>
        {detailModal && (
          <>
            <div className="rc-modal-head">
              <Pill tone={detailModal.status.tone} dot>{detailModal.status.label}</Pill>
              <span className="rc-modal-sub">{detailModal.sub}</span>
            </div>
            <StageBreadcrumb b={detailModal.stage} />
            <div className="rc-detail-grid">
              {detailModal.detail.fields.map((f) => (
                <div className="rcd-field" key={f.label}>
                  <span className="rcd-label">{f.label}</span>
                  <span className="rcd-value">{f.value}</span>
                </div>
              ))}
            </div>
            {detailModal.detail.note && (
              <div className="rc-detail-note"><Icon name="flag" size={12} /> <span>{detailModal.detail.note}</span></div>
            )}
            <div className="rc-detail-foot">
              <Button size="sm" onClick={() => { const r = detailModal; setDetailModal(null); r.onView() }}>
                Open full {detailModal.viewLabel.replace(/^View\s+/, '')} →
              </Button>
            </div>
          </>
        )}
      </Modal>

    </div>
  )
}

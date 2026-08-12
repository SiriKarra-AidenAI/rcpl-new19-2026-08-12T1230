import './Analytics.css'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Modal, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import type { IconName } from '../components/ui/icons'
import { Sparkline } from '../components/ui/Sparkline'
import { useApp } from '../store'
import {
  DB_PERFORMANCE, DB_GAP_CATEGORIES, TREND, RISK_TREND, REGION_PERFORMANCE,
  dbAttainment, dbCoverage, dbGaps, dbStatus,
} from '../mock/analytics'
import type { BarDatum, DbPerf, DbStatus } from '../mock/analytics'
import type { Grievance } from '../mock/grievances'
import {
  FUNNEL_STAGES, LEAD_TO_ONBOARD_CONVERSION_PCT, TAT_TREND_HOURS, AVG_TAT_HOURS, TAT_TARGET_HOURS,
  APP_DOWNLOAD_TO_REGISTRATION_PCT, FTR_TREND_PCT, FTR_RATE_PCT, KYC_REJECTION_REASONS, KYC_REJECTION_RATE_PCT,
  CREDIT_ELIGIBILITY_PASS_PCT, FTB_TREND_PCT, FTB_RATE_PCT, FTL_TICKET_TREND_INR_L, AVG_FTL_TICKET_INR_L,
  STAGNANT_AT_BIRTH_TREND_PCT, STAGNANT_AT_BIRTH_PCT, WHITE_SPACE_CONVERSIONS, WHITE_SPACE_TOTAL,
  CATEGORY_REPRESENTATION, FIELD_EXECUTIVES, AVG_ONBOARDINGS_PER_FOS_PER_DAY, AVG_CAC_INR, CAC_TREND_INR,
} from '../mock/onboardingEfficiency'
import { GTM_STATES, SVG_ID, REGION_OF, stateCodeForTown } from '../mock/gtm'
import type { GtmRegion } from '../mock/gtm'
import { DEMO_USERS } from '../mock/roles'
import { inDataScope, inDataScopeByTown } from '../lib/dataScope'
import { tenureYears, tenureBucket } from '../lib/dates'
import type { Partner } from '../types'
import INDIA_MAP from '@svg-maps/india'

// Analytics answers two questions: the at-a-glance health of the distributor book (this
// overview — coverage, turnover-vs-plan, regional spread, risk trend), and the detailed
// per-DB scorecard below it for drilling into exactly where any one distributor is short.
export function Analytics() {
  const addReport = useApp((s) => s.addReport)
  const logAudit = useApp((s) => s.logAudit)
  const navigate = useNavigate()
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const dataScopeByRole = useApp((s) => s.dataScopeByRole)
  const dataEntitiesByRole = useApp((s) => s.dataEntitiesByRole)
  const analyticsSectionsByRole = useApp((s) => s.analyticsSectionsByRole)
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState<'all' | DbStatus>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersRef = useRef<HTMLDivElement>(null)
  const [rangePreset, setRangePreset] = useState<'this_month' | 'last_30' | 'last_quarter'>('this_month')
  const [rangeOpen, setRangeOpen] = useState(false)
  const rangeRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'overview' | 'detail' | 'efficiency'>('overview')

  // Time-of-day greeting for the current persona — first name where the demo user record has a
  // full one (e.g. "Atishay Jain" → "Atishay"), otherwise the display name as stored.
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const fullName = DEMO_USERS[viewingAs]?.name ?? 'there'
  const firstToken = fullName.split(/\s+/)[0]
  const greetName = firstToken.replace(/\.$/, '').length > 1 ? firstToken : fullName

  // Which of Analytics' 3 tabs the Super Admin has left visible for this persona (Admin > Data
  // access > "Analytics tabs") — hide the rest and fall back off a now-hidden current tab.
  const visibleSections = analyticsSectionsByRole[viewingAs] ?? ['overview', 'detail', 'efficiency']
  useEffect(() => {
    if (!visibleSections.includes(tab) && visibleSections.length > 0) setTab(visibleSections[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSections.join(',')])

  // Data-level RBAC: a scoped persona (set by the Super Admin in Admin > Data access) only sees
  // DB performance rows in their own region/state here, if "Analytics" is checked as one of the
  // screens that scope applies to for this persona.
  const myScope = dataScopeByRole[viewingAs]
  const myRegion = DEMO_USERS[viewingAs]?.region
  const myState = DEMO_USERS[viewingAs]?.state
  const scopesAnalytics = (dataEntitiesByRole[viewingAs] ?? []).includes('analytics')
  const isRegionScoped = myScope !== 'all' && scopesAnalytics
  const scopedPerformance = isRegionScoped
    ? DB_PERFORMANCE.filter((d) => inDataScopeByTown(d.town, myScope, myRegion, myState))
    : DB_PERFORMANCE

  // Headline "Active Distributors" — the same live Partners directory GTM Coverage and the
  // Partners screen itself now both read, not DB_PERFORMANCE.length (a 10-row curated sample
  // used for the detail scorecard below) or a static ingested-sheet count. Keeps all three
  // screens' totals in permanent agreement. Kept as the actual partner list, not just a count,
  // so the KPI tile can show who's actually in it instead of only linking away to Partners.
  const partners = useApp((s) => s.partners)
  const scopedGtmCodes = useMemo(() => {
    const withData = GTM_STATES.filter((s) => s.target != null && s.actual != null)
    const scoped = isRegionScoped ? withData.filter((s) => inDataScope(s.code, myScope, myRegion, myState)) : withData
    return new Set(scoped.map((s) => s.code))
  }, [isRegionScoped, myScope, myRegion, myState])
  const activeDistributorPartners = useMemo(
    () => partners.filter((p) => p.partnerType === 'distributor' && p.status !== 'discontinued' && scopedGtmCodes.has(p.state)),
    [partners, scopedGtmCodes],
  )
  // Same distributor set, but every one (including discontinued) that carries a real
  // onboardedAt/discontinuedAt date — lets the KPI tile's trend/delta be reconstructed from
  // actual onboarding history instead of a decorative fabricated curve.
  const distributorPartnersForTrend = useMemo(
    () => partners.filter((p) => p.partnerType === 'distributor' && scopedGtmCodes.has(p.state) && !!p.onboardedAt),
    [partners, scopedGtmCodes],
  )

  const categories = useMemo(() => Array.from(new Set(scopedPerformance.map((d) => d.category))), [scopedPerformance])
  const dbs = scopedPerformance.filter((d) =>
    (category === 'all' || d.category === category) && (status === 'all' || dbStatus(d) === status))
  const activeFilterCount = (category !== 'all' ? 1 : 0) + (status !== 'all' ? 1 : 0)
  const resetFilters = () => { setCategory('all'); setStatus('all') }

  useEffect(() => {
    if (!filtersOpen) return
    const onClick = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) setFiltersOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [filtersOpen])

  useEffect(() => {
    if (!rangeOpen) return
    const onClick = (e: MouseEvent) => {
      if (rangeRef.current && !rangeRef.current.contains(e.target as Node)) setRangeOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [rangeOpen])

  const exportView = () => {
    addReport({ name: 'Analytics export — distributor performance', format: 'PDF' })
    logAudit({ actor: 'You', kind: 'human', action: 'Exported analytics view to Reports', entity: 'Analytics' })
    navigate('/reports')
  }

  // Formatted like a date-range picker's display label — start date depends on the chosen preset.
  const dateRangeLabel = useMemo(() => {
    const now = new Date()
    const start = rangePreset === 'this_month' ? new Date(now.getFullYear(), now.getMonth(), 1)
      : rangePreset === 'last_30' ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      : new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
    const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    return `${fmt(start)} – ${fmt(now)}`
  }, [rangePreset])
  const RANGE_LABEL: Record<typeof rangePreset, string> = {
    this_month: 'This month', last_30: 'Last 30 days', last_quarter: 'Last quarter',
  }

  return (
    <div>
      <div className="page-head">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: '0.8rem' }}>
          <div className="an-greet">
            <h1>{greeting}, {greetName}</h1>
          </div>
          <div className="an2-controls">
            <div className="an2-filters-wrap" ref={rangeRef}>
              <button className="an2-daterange" onClick={() => setRangeOpen((v) => !v)}>
                <Icon name="calendar" size={14} /> {dateRangeLabel}
              </button>
              {rangeOpen && (
                <div className="an2-filters-pop">
                  {(['this_month', 'last_30', 'last_quarter'] as const).map((p) => (
                    <button key={p} className={`pt-filter-chip ${rangePreset === p ? 'on' : ''}`} style={{ width: '100%', marginBottom: '0.3rem' }}
                      onClick={() => { setRangePreset(p); setRangeOpen(false) }}>
                      {RANGE_LABEL[p]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="an2-filters-wrap" ref={filtersRef}>
              <Button variant="ghost" onClick={() => setFiltersOpen((v) => !v)}>
                <Icon name="filter" size={13} /> Filters
                {activeFilterCount > 0 && <span className="an2-filter-badge">{activeFilterCount}</span>}
              </Button>
              {filtersOpen && (
                <div className="an2-filters-pop">
                  <label className="an2-filter-row">
                    <span>Category</span>
                    <select className="mini-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="all">All categories</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="an2-filter-row">
                    <span>Status</span>
                    <select className="mini-select" value={status} onChange={(e) => setStatus(e.target.value as 'all' | DbStatus)}>
                      <option value="all">All statuses</option>
                      <option value="on_track">On track</option>
                      <option value="watch">Watch</option>
                      <option value="at_risk">At risk</option>
                    </select>
                  </label>
                  {activeFilterCount > 0 && <button className="btn text sm" style={{ padding: 0 }} onClick={resetFilters}>Reset filters</button>}
                </div>
              )}
            </div>
            <Button onClick={exportView}><Icon name="download" size={14} /> Export</Button>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: '1rem' }}>
        {visibleSections.includes('overview') && (
          <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        )}
        {visibleSections.includes('detail') && (
          <button className={`tab ${tab === 'detail' ? 'active' : ''}`} onClick={() => setTab('detail')}>Distributor Detail</button>
        )}
        {visibleSections.includes('efficiency') && (
          <button className={`tab ${tab === 'efficiency' ? 'active' : ''}`} onClick={() => setTab('efficiency')}>Onboarding Efficiency</button>
        )}
      </div>

      {visibleSections.length === 0 ? (
        <Card><p style={{ padding: '0.5rem 0' }}>Your persona doesn't have access to any Analytics tab — set by the Super Admin in Admin &gt; Data access.</p></Card>
      ) : tab === 'overview' ? <AnalyticsOverview dbs={dbs} activeDistributorPartners={activeDistributorPartners} distributorPartnersForTrend={distributorPartnersForTrend} /> : tab === 'detail' ? <AnalyticsDetail dbs={dbs} /> : <AnalyticsEfficiency />}
    </div>
  )
}

/* ==================================================================
   Overview — KPI tiles + the six new charts
   ================================================================== */
const TONE_VAR: Record<string, string> = { ai: '--ai', good: '--good', warn: '--warn', crit: '--crit', blue: '--chart-5' }

function KpiTile({ icon, tone, label, value, sub, trend, onClick }:
  { icon: 'partners' | 'check' | 'target' | 'analytics' | 'alert' | 'flag' | 'clock' | 'shield'; tone: string; label: string; value: string; sub: ReactNode; trend?: number[]; onClick?: () => void }) {
  return (
    <button type="button" className="an2-kpi an2-kpi-btn" onClick={onClick} disabled={!onClick}>
      <div className="an2-kpi-top">
        <span className="an2-kpi-label">{label}</span>
        <span className={`an2-kpi-ic tone-${tone}`}><Icon name={icon} size={14} /></span>
      </div>
      <div className="an2-kpi-val">{value}</div>
      <div className="an2-kpi-sub">{sub}</div>
      {trend && <div className="an2-kpi-spark"><Sparkline data={trend} color={`var(${TONE_VAR[tone]})`} responsive height={28} /></div>}
      {onClick && <span className="an2-kpi-hint">What made this? →</span>}
    </button>
  )
}

type OverviewKpiKey = 'on_track' | 'attainment' | 'coverage' | 'low_fill' | 'tenure'
const OVERVIEW_KPI_TITLE: Record<OverviewKpiKey, string> = {
  on_track: 'Distributors on track', attainment: 'Target attainment by distributor',
  coverage: 'Coverage by distributor', low_fill: 'Distributors with low fill rate',
  tenure: 'Partner tenure by distributor',
}

// How many of `list` were still active as of `cutoff` (epoch ms) — onboarded on/before that
// date, and not yet discontinued by it. Lets a KPI tile's "vs last month" be reconstructed from
// partners' real onboardedAt/discontinuedAt dates instead of a fabricated number.
function partnersActiveAsOf(list: Partner[], cutoff: number): number {
  return list.filter((p) => {
    const onboarded = new Date(p.onboardedAt as string).getTime()
    if (Number.isNaN(onboarded) || onboarded > cutoff) return false
    if (p.discontinuedAt && new Date(p.discontinuedAt).getTime() <= cutoff) return false
    return true
  }).length
}

// Signed delta → an honest "▲/▼ N{unit} vs last month" pill, or a flat dash when there's
// literally no change — never a fabricated number.
function deltaNote(delta: number, unit: string, goodIfUp = true): ReactNode {
  if (delta === 0) return <span className="an2-delta-flat">— vs last month</span>
  const up = delta > 0
  const good = goodIfUp ? up : !up
  return <span className={good ? 'an2-delta-good' : 'an2-delta-bad'}>{up ? '▲' : '▼'} {Math.abs(delta)}{unit} vs last month</span>
}

function AnalyticsOverview({ dbs, activeDistributorPartners, distributorPartnersForTrend }:
  { dbs: DbPerf[]; activeDistributorPartners: Partner[]; distributorPartnersForTrend: Partner[] }) {
  const navigate = useNavigate()
  const grievances = useApp((s) => s.grievances)
  const [breakdown, setBreakdown] = useState<OverviewKpiKey | null>(null)
  // "Active Distributors" shows who's actually in that count right here instead of just
  // linking away to Partners — its own modal since the rows are real Partner records, not
  // DbPerf ones like every other KPI tile's breakdown.
  const [showActivePartners, setShowActivePartners] = useState(false)
  const n = dbs.length || 1
  const counts = dbs.reduce((a, d) => { a[dbStatus(d)]++; return a }, { on_track: 0, watch: 0, at_risk: 0 } as Record<DbStatus, number>)
  const avgCoverage = Math.round(dbs.reduce((s, d) => s + dbCoverage(d), 0) / n)
  const lowFill = dbs.filter((d) => d.fillRate < 90).length
  const avgTenureYrs = dbs.reduce((s, d) => s + tenureYears(d.onboardedAt), 0) / n

  // Real 6-month history of "Active Distributors" — count actually-active-as-of-that-month-end
  // from partners' own onboarded/discontinued dates, ending exactly at today's live count.
  const activeTrend = useMemo(() => {
    const now = new Date()
    const pts = Array.from({ length: 5 }, (_, i) => {
      const monthsBack = 5 - i
      const cutoff = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0, 23, 59, 59).getTime()
      return partnersActiveAsOf(distributorPartnersForTrend, cutoff)
    })
    pts.push(activeDistributorPartners.length)
    return pts
  }, [distributorPartnersForTrend, activeDistributorPartners.length])
  const activeDelta = activeTrend[3] ? Math.round(((activeTrend[4] - activeTrend[3]) / activeTrend[3]) * 100) : 0

  // Real "Avg Target Attainment" history — same sum(turnover)/sum(target) the Turnover vs
  // Target chart below uses, so the two never disagree; respects the active category/status
  // filters and region scope because it's built from the already-filtered `dbs`.
  const attainTrend = useMemo(() => {
    const targetTotal = dbs.reduce((s, d) => s + d.rcplTarget, 0)
    if (!targetTotal) return TREND.map(() => 0)
    return TREND.map((_, i) => Math.round((dbs.reduce((s, d) => s + (d.trend[i] ?? 0), 0) / targetTotal) * 100))
  }, [dbs])
  const avgAttain = attainTrend[attainTrend.length - 1] ?? 0
  const attainDelta = attainTrend.length >= 2 ? attainTrend[attainTrend.length - 1] - attainTrend[attainTrend.length - 2] : 0

  // "On Track" history only exists for the full, unfiltered book (RISK_TREND was tracked
  // against all 10 DBs) — skip the trend/delta rather than fabricate one once a filter/region
  // scope narrows `dbs` to a subset that history was never broken out for.
  const isFullBook = dbs.length === DB_PERFORMANCE.length
  const onTrackTrend = isFullBook ? RISK_TREND.map((r) => DB_PERFORMANCE.length - r.atRisk - r.watch) : undefined
  const onTrackDelta = onTrackTrend && onTrackTrend.length >= 2
    ? onTrackTrend[onTrackTrend.length - 1] - onTrackTrend[onTrackTrend.length - 2] : undefined

  // What each KPI tile actually rolls up — the ranked/filtered distributor list behind its
  // number, same "what made this" pattern Partners.tsx's stat tiles use.
  const breakdownRows = (key: OverviewKpiKey | null): { d: DbPerf; metric: string }[] => {
    if (key === 'on_track') return dbs.filter((d) => dbStatus(d) === 'on_track').map((d) => ({ d, metric: `${dbAttainment(d)}% attainment` }))
    if (key === 'attainment') return [...dbs].sort((a, b) => dbAttainment(b) - dbAttainment(a)).map((d) => ({ d, metric: `${dbAttainment(d)}%` }))
    if (key === 'coverage') return [...dbs].sort((a, b) => dbCoverage(b) - dbCoverage(a)).map((d) => ({ d, metric: `${dbCoverage(d)}%` }))
    if (key === 'low_fill') return dbs.filter((d) => d.fillRate < 90).sort((a, b) => a.fillRate - b.fillRate).map((d) => ({ d, metric: `${d.fillRate}% fill rate` }))
    if (key === 'tenure') return [...dbs].sort((a, b) => tenureYears(b.onboardedAt) - tenureYears(a.onboardedAt)).map((d) => ({ d, metric: `${tenureYears(d.onboardedAt).toFixed(1)} yrs` }))
    return []
  }

  return (
    <div className="an2-stack">
      <div className="an2-kpis">
        <KpiTile icon="partners" tone="ai" label="Active Distributors" value={String(activeDistributorPartners.length)}
          sub={deltaNote(activeDelta, '%')} trend={activeTrend}
          onClick={() => setShowActivePartners(true)} />
        <KpiTile icon="check" tone="good" label="On Track" value={String(counts.on_track)}
          sub={onTrackDelta !== undefined ? deltaNote(onTrackDelta, '') : `${Math.round((counts.on_track / n) * 100)}% of active`}
          trend={onTrackTrend} onClick={() => setBreakdown('on_track')} />
        <KpiTile icon="target" tone="blue" label="Avg Target Attainment" value={`${avgAttain}%`}
          sub={deltaNote(attainDelta, 'pp')} trend={attainTrend}
          onClick={() => setBreakdown('attainment')} />
        <KpiTile icon="analytics" tone="warn" label="Avg Coverage" value={`${avgCoverage}%`}
          sub={`${dbs.filter((d) => dbCoverage(d) >= 85).length} of ${n} at/above plan`}
          onClick={() => setBreakdown('coverage')} />
        <KpiTile icon="alert" tone="crit" label="Low Fill Rate" value={String(lowFill)}
          sub={`${Math.round((lowFill / n) * 100)}% of active`}
          onClick={() => setBreakdown('low_fill')} />
        <KpiTile icon="target" tone="ai" label="Avg Partner Tenure" value={`${avgTenureYrs.toFixed(1)} yrs`}
          sub="How long DBs have been with RCPL" onClick={() => setBreakdown('tenure')} />
      </div>

      <Modal open={!!breakdown} onClose={() => setBreakdown(null)} title={breakdown ? OVERVIEW_KPI_TITLE[breakdown] : ''}>
        <div className="pt-breakdown">
          {breakdownRows(breakdown).length === 0 ? (
            <p className="muted-note">No distributors contribute to this figure right now.</p>
          ) : breakdownRows(breakdown).map(({ d, metric }) => (
            <button key={d.id} className="pt-breakdown-row" onClick={() => { navigate('/partners', { state: { query: d.name } }); setBreakdown(null) }}>
              <span className="pt-breakdown-main">
                <span className="n">{d.name}</span>
                <span className="t">{d.town} · {d.category}</span>
              </span>
              <span className="pt-breakdown-metric"><span className="v">{metric}</span></span>
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={showActivePartners} onClose={() => setShowActivePartners(false)} title="Active Distributors">
        <div className="pt-breakdown">
          {activeDistributorPartners.length === 0 ? (
            <p className="muted-note">No active distributor partners right now.</p>
          ) : activeDistributorPartners.map((p) => (
            <button key={p.id} className="pt-breakdown-row" onClick={() => { navigate('/partners', { state: { query: p.legalName } }); setShowActivePartners(false) }}>
              <span className="pt-breakdown-main">
                <span className="n">{p.legalName}</span>
                <span className="t">{p.town}, {p.state}</span>
              </span>
              <span className="pt-breakdown-metric"><span className="v">{p.status === 'active' ? 'Active' : 'In review'}</span></span>
            </button>
          ))}
        </div>
      </Modal>

      <div className="an-row2">
        <Card><PartnerAging /></Card>
        <Card><AiInsight dbs={dbs} /></Card>
      </div>

      <div className="an-row2">
        <Card><AdvancedChart dbs={dbs} /></Card>
        <Card><TopMovers dbs={dbs} /></Card>
      </div>

      <div className="an2-hero">
        <Card><CoverageByRegion /></Card>
        <Card><PerformanceHeatmap dbs={dbs} /></Card>
      </div>

      <Card><ActivityHeatmap /></Card>

      <div className="an-row2">
        <div className="an2-stack">
          <Card title="Where distributors are lacking"><HBars data={gapFreq(dbs)} showSub alt /></Card>
          <Card><KeyAlerts dbs={dbs} grievances={grievances} /></Card>
        </div>
        <Card>
          <div className="an-card-head">
            <span className="card-title" style={{ margin: 0 }}>Which DB is lacking</span>
            <button className="an-viewall" onClick={() => navigate('/partners')}>View all →</button>
          </div>
          <NeedsAttention dbs={needsAttentionList(dbs)} />
        </Card>
      </div>

      <Card><FillVsCoverage dbs={dbs} /></Card>
    </div>
  )
}

// Deeper distributor-level detail, split into its own tab so the default Overview stays short —
// turnover-vs-plan trend and the grievance breakdown.
function AnalyticsDetail({ dbs }: { dbs: DbPerf[] }) {
  const grievances = useApp((s) => s.grievances)
  const n = dbs.length || 1
  const avgAttain = Math.round(dbs.reduce((s, d) => s + dbAttainment(d), 0) / n)
  const latestTurnover = dbs.reduce((s, d) => s + (d.trend[d.trend.length - 1] ?? 0), 0)
  const targetTotal = dbs.reduce((s, d) => s + d.rcplTarget, 0)
  const openGrievances = grievances.filter((g) => g.status !== 'resolved').length
  const overdueGrievances = grievances.filter((g) => g.isOverdue).length

  return (
    <div className="an2-stack">
      <div className="an-detail-intro">
        <span className="an-detail-intro-ic"><Icon name="analytics" size={16} /></span>
        <div>
          <h3>Distributor Detail</h3>
          <p>How the current book is tracking against its monthly turnover target, plus a breakdown of open distributor grievances by region and category.</p>
        </div>
      </div>

      <div className="an2-kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile icon="partners" tone="ai" label="Distributors in View" value={String(dbs.length)}
          sub="Matching the current filters" />
        <KpiTile icon="target" tone={avgAttain >= 100 ? 'good' : 'warn'} label="Avg Target Attainment" value={`${avgAttain}%`}
          sub={`₹${latestTurnover}L of ₹${targetTotal}L target`} />
        <KpiTile icon="flag" tone={overdueGrievances > 0 ? 'crit' : 'good'} label="Overdue Grievances" value={String(overdueGrievances)}
          sub="Open more than the SLA window" />
        <KpiTile icon="alert" tone={openGrievances > 0 ? 'warn' : 'good'} label="Open Grievances" value={String(openGrievances)}
          sub="Awaiting resolution" />
      </div>

      <Card><TurnoverVsTarget dbs={dbs} /></Card>
      <Card><CompareDistributors dbs={dbs} /></Card>
      <Card><GrievancesOverview /></Card>
    </div>
  )
}

/* ---------------- Compare Distributors — pick any two, see every metric side by side ---------------- */
const COMPARE_METRICS: { key: string; label: string; unit: string; get: (d: DbPerf) => number; higherIsBetter: boolean }[] = [
  { key: 'attainment', label: 'Target attainment', unit: '%', get: dbAttainment, higherIsBetter: true },
  { key: 'coverage', label: 'Coverage', unit: '%', get: dbCoverage, higherIsBetter: true },
  { key: 'turnover', label: 'RCPL turnover', unit: '₹L', get: (d) => d.rcplTurnover, higherIsBetter: true },
  { key: 'outlets', label: 'Outlets served', unit: '', get: (d) => d.outlets, higherIsBetter: true },
  { key: 'growth', label: 'Growth MoM', unit: '%', get: (d) => d.growthMoM, higherIsBetter: true },
  { key: 'fillRate', label: 'Fill rate', unit: '%', get: (d) => d.fillRate, higherIsBetter: true },
  { key: 'wsContribution', label: 'RCPL share of business', unit: '%', get: (d) => d.wsContribution, higherIsBetter: true },
  { key: 'tenure', label: 'Partner tenure', unit: ' yrs', get: (d) => +tenureYears(d.onboardedAt).toFixed(1), higherIsBetter: true },
]

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

function CompareDistributors({ dbs }: { dbs: DbPerf[] }) {
  const navigate = useNavigate()
  // Narrows which distributors show up in the A/B pickers below — independent of the page-level
  // filters (dbs already reflects those), so you can e.g. line up two "at risk" DBs specifically
  // without scrolling past every on-track one in a long dropdown.
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterStatus, setFilterStatus] = useState<'all' | DbStatus>('all')
  const categories = useMemo(() => Array.from(new Set(dbs.map((d) => d.category))), [dbs])
  const sorted = useMemo(
    () => [...dbs]
      .filter((d) => filterCategory === 'all' || d.category === filterCategory)
      .filter((d) => filterStatus === 'all' || dbStatus(d) === filterStatus)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [dbs, filterCategory, filterStatus],
  )
  const [aId, setAId] = useState(sorted[0]?.id ?? '')
  const [bId, setBId] = useState(sorted[1]?.id ?? '')
  useEffect(() => {
    if (!sorted.some((d) => d.id === aId)) setAId(sorted[0]?.id ?? '')
    if (!sorted.some((d) => d.id === bId)) setBId(sorted[1]?.id ?? sorted[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted.map((d) => d.id).join(',')])
  const a = sorted.find((d) => d.id === aId)
  const b = sorted.find((d) => d.id === bId)
  const filtersActive = filterCategory !== 'all' || filterStatus !== 'all'

  return (
    <div className="an2-chart">
      <div className="an2-chart-head"><span className="card-title" style={{ margin: 0 }}>Compare Distributors</span></div>
      <div className="an-cmp-filters">
        <select className="mini-select" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="mini-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | DbStatus)}>
          <option value="all">All statuses</option>
          <option value="on_track">On track</option>
          <option value="watch">Watch</option>
          <option value="at_risk">At risk</option>
        </select>
        {filtersActive && (
          <button className="btn text sm" style={{ padding: 0 }} onClick={() => { setFilterCategory('all'); setFilterStatus('all') }}>Reset</button>
        )}
      </div>
      {sorted.length < 2 ? (
        <p className="muted-note">Need at least 2 distributors matching these filters to compare.</p>
      ) : a && b ? (
        <div className="an-cmp">
          <div className="an-cmp-head">
            <button type="button" className="an-cmp-side" onClick={() => navigate('/partners', { state: { query: a.name } })}>
              <span className="an-cmp-avatar a">{initials(a.name)}</span>
              <span className="an-cmp-name">{a.name}</span>
              <span className="an-cmp-sub">{a.town} · {a.category}</span>
              <Pill tone={STATUS_META[dbStatus(a)].tone}>{STATUS_META[dbStatus(a)].label}</Pill>
            </button>
            <select className="mini-select an-cmp-swap" value={aId} onChange={(e) => setAId(e.target.value)}>
              {sorted.map((d) => <option key={d.id} value={d.id} disabled={d.id === bId}>{d.name}</option>)}
            </select>
            <span className="an-cmp-vs">VS</span>
            <select className="mini-select an-cmp-swap" value={bId} onChange={(e) => setBId(e.target.value)}>
              {sorted.map((d) => <option key={d.id} value={d.id} disabled={d.id === aId}>{d.name}</option>)}
            </select>
            <button type="button" className="an-cmp-side" onClick={() => navigate('/partners', { state: { query: b.name } })}>
              <span className="an-cmp-avatar b">{initials(b.name)}</span>
              <span className="an-cmp-name">{b.name}</span>
              <span className="an-cmp-sub">{b.town} · {b.category}</span>
              <Pill tone={STATUS_META[dbStatus(b)].tone}>{STATUS_META[dbStatus(b)].label}</Pill>
            </button>
          </div>

          <div className="an-cmp-metrics">
            {COMPARE_METRICS.map((m) => {
              const va = m.get(a), vb = m.get(b)
              const aWins = m.higherIsBetter ? va > vb : va < vb
              const bWins = m.higherIsBetter ? vb > va : vb < va
              const scale = Math.max(Math.abs(va), Math.abs(vb), 1)
              const pctA = Math.min(100, (Math.abs(va) / scale) * 100)
              const pctB = Math.min(100, (Math.abs(vb) / scale) * 100)
              return (
                <div className="an-cmp-metric" key={m.key}>
                  <div className="an-cmp-metric-label">{m.label}</div>
                  <div className="an-cmp-metric-row">
                    <span className={`an-cmp-val left ${aWins ? 'win' : ''}`}>{va}{m.unit}</span>
                    <div className="an-cmp-bars">
                      <div className="an-cmp-half left"><div className="an-cmp-fill a" style={{ width: `${pctA}%` }} /></div>
                      <span className="an-cmp-mid" aria-hidden />
                      <div className="an-cmp-half right"><div className="an-cmp-fill b" style={{ width: `${pctB}%` }} /></div>
                    </div>
                    <span className={`an-cmp-val right ${bWins ? 'win' : ''}`}>{vb}{m.unit}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ==================================================================
   Onboarding Efficiency — funnel velocity, KYC compliance, activation/FTB,
   territory penetration, and field-force productivity/CAC. All from
   mock/onboardingEfficiency.ts, none of it hardcoded inline.
   ================================================================== */
function SectionHead({ icon, title, blurb }: { icon: IconName; title: string; blurb: string }) {
  return (
    <div className="an-eff-head">
      <span className="an-eff-head-ic"><Icon name={icon} size={16} /></span>
      <div className="an-eff-head-text">
        <h3>{title}</h3>
        <p>{blurb}</p>
      </div>
    </div>
  )
}

function FunnelChart({ stages }: { stages: { stage: string; count: number }[] }) {
  const max = stages[0]?.count || 1
  return (
    <div className="an-funnel">
      {stages.map((s, i) => {
        const pct = Math.round((s.count / max) * 100)
        const dropFromPrev = i > 0 ? Math.round(((stages[i - 1].count - s.count) / stages[i - 1].count) * 100) : null
        return (
          <div className="an-funnel-row" key={s.stage}>
            <div className="an-funnel-label">
              <span className="nm">{s.stage}</span>
              <span className="vv">{s.count.toLocaleString()}{dropFromPrev !== null && <span className="drop"> · -{dropFromPrev}%</span>}</span>
            </div>
            <div className="an-funnel-track"><div className="an-funnel-fill" style={{ width: `${pct}%` }} /></div>
          </div>
        )
      })}
    </div>
  )
}

function AnalyticsEfficiency() {
  return (
    <div className="an2-stack">
      <SectionHead icon="target" title="Pipeline Scale & Funnel Velocity"
        blurb="How efficiently the team moves a prospective partner from a mapped lead to a fully registered, live entity." />
      <div className="an2-kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KpiTile icon="target" tone="ai" label="Lead-to-Onboard Conversion" value={`${LEAD_TO_ONBOARD_CONVERSION_PCT}%`}
          sub="Mapped leads that reach Registered/Live" />
        <KpiTile icon="clock" tone={AVG_TAT_HOURS <= TAT_TARGET_HOURS.max ? 'good' : 'warn'} label="Avg Onboarding TAT" value={`${AVG_TAT_HOURS}h`}
          sub={`Target ${TAT_TARGET_HOURS.min}-${TAT_TARGET_HOURS.max}h`} trend={TAT_TREND_HOURS} />
        <KpiTile icon="partners" tone="blue" label="App Download → Registration" value={`${APP_DOWNLOAD_TO_REGISTRATION_PCT}%`}
          sub="Downloaded the app and completed registration" />
      </div>
      <Card title="Onboarding Funnel"><FunnelChart stages={FUNNEL_STAGES} /></Card>

      <SectionHead icon="shield" title="Document Compliance & KYC"
        blurb="The onboarding team as gatekeeper — catching fraudulent or unviable entities before they reach the platform." />
      <div className="an2-kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KpiTile icon="check" tone="good" label="First-Time-Right Rate" value={`${FTR_RATE_PCT}%`}
          sub="Applications passing verification on the first attempt" trend={FTR_TREND_PCT} />
        <KpiTile icon="alert" tone="crit" label="KYC Rejection Rate" value={`${KYC_REJECTION_RATE_PCT}%`}
          sub="Mismatched or invalid documents" />
        <KpiTile icon="shield" tone="ai" label="Credit Eligibility Pass Rate" value={`${CREDIT_ELIGIBILITY_PASS_PCT}%`}
          sub="Clear internal credit/bank verification" />
      </div>
      <Card title="KYC Rejection Reasons"><HBars data={KYC_REJECTION_REASONS} showSub alt /></Card>

      <SectionHead icon="check" title="Early Activation & First Time Buy (FTB)"
        blurb="An onboarded partner is a vanity metric until they place their first order — this is where onboarding actually pays off." />
      <div className="an2-kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KpiTile icon="target" tone="good" label="FTB Rate (7-14 days)" value={`${FTB_RATE_PCT}%`}
          sub="Newly registered partners placing a first order" trend={FTB_TREND_PCT} />
        <KpiTile icon="analytics" tone="blue" label="Avg FTL Ticket Size" value={`₹${AVG_FTL_TICKET_INR_L}L`}
          sub="Value of that first commercial order" trend={FTL_TICKET_TREND_INR_L} />
        <KpiTile icon="alert" tone="warn" label="Stagnant-at-Birth Rate" value={`${STAGNANT_AT_BIRTH_PCT}%`}
          sub="Zero orders 30 days after onboarding" trend={STAGNANT_AT_BIRTH_TREND_PCT} />
      </div>

      <SectionHead icon="flag" title="Territory Penetration & White-Space Capture"
        blurb="Expanding into low-market-share regions, not just over-indexing on easy, already-saturated urban pockets." />
      <div className="an2-kpis" style={{ gridTemplateColumns: 'repeat(1, 1fr)' }}>
        <KpiTile icon="flag" tone="ai" label="White-Space Conversions" value={String(WHITE_SPACE_TOTAL)}
          sub="New partners acquired in newly opened / underserved pin codes" />
      </div>
      <div className="an-row2">
        <Card title="White-Space Conversions by Tier"><HBars data={WHITE_SPACE_CONVERSIONS} showSub /></Card>
        <Card title="Category Representation"><HBars data={CATEGORY_REPRESENTATION} showSub alt /></Card>
      </div>

      <SectionHead icon="partners" title="Field Force Productivity & CAC"
        blurb="Efficiency and cost of the Feet-on-Street (FOS) field force driving onboarding volume." />
      <div className="an2-kpis" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <KpiTile icon="partners" tone="good" label="Avg Onboardings / FOS / Day" value={String(AVG_ONBOARDINGS_PER_FOS_PER_DAY)}
          sub="Verified partners registered per field executive per day" />
        <KpiTile icon="analytics" tone="warn" label="Avg Customer Acquisition Cost" value={`₹${AVG_CAC_INR.toLocaleString()}`}
          sub="Field cost per successfully activated partner" trend={CAC_TREND_INR} />
      </div>
      <Card title="Field Executive Productivity">
        <div className="an2-ranked">
          {[...FIELD_EXECUTIVES].sort((a, b) => b.onboardingsPerDay - a.onboardingsPerDay).map((f) => (
            <div className="an-fe-row" key={f.id}>
              <div className="an-fe-main">
                <span className="nm">{f.name}</span>
                <span className="an-fe-region">{f.region}</span>
              </div>
              <div className="an-fe-stats">
                <span title="Onboardings / day"><b>{f.onboardingsPerDay}</b>/day</span>
                <span title="Total onboarded"><b>{f.totalOnboarded}</b> total</span>
                <span title="Customer acquisition cost"><b>₹{f.cacInr.toLocaleString()}</b> CAC</span>
                <span className={f.earlyChurnPct >= 15 ? 'crit' : 'good'} title="Early churn — stopped buying after month one">
                  <b>{f.earlyChurnPct}%</b> churn
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/* ---------------- Grievances — stats, open-only breakdowns, and the most urgent list ---------------- */
const PRIORITY_WEIGHT: Record<Grievance['priority'], number> = { high: 2, medium: 1, low: 0 }
const PRIORITY_TONE: Record<Grievance['priority'], 'crit' | 'warn' | 'good'> = { high: 'crit', medium: 'warn', low: 'good' }

function GrievancesOverview() {
  const navigate = useNavigate()
  const grievances = useApp((s) => s.grievances)
  const total = grievances.length
  const open = grievances.filter((g) => g.status !== 'resolved')
  const overdue = grievances.filter((g) => g.isOverdue)
  const resolved = grievances.filter((g) => g.status === 'resolved')

  // Breakdowns count only OPEN/in-progress grievances — mixing in resolved ones just dilutes
  // where the active problem actually is.
  const byRegion = new Map<GtmRegion, number>()
  open.forEach((g) => {
    const code = stateCodeForTown(g.town)
    const region = code ? REGION_OF[code] : undefined
    if (region) byRegion.set(region, (byRegion.get(region) ?? 0) + 1)
  })
  const regionData: BarDatum[] = [...byRegion.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)

  const byCategory = new Map<string, number>()
  open.forEach((g) => byCategory.set(g.category, (byCategory.get(g.category) ?? 0) + 1))
  const categoryData: BarDatum[] = [...byCategory.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)

  const urgent = [...open]
    .sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || b.ageDays - a.ageDays)
    .slice(0, 5)

  if (total === 0) {
    return (
      <div className="an2-chart">
        <div className="an2-chart-head"><span className="card-title" style={{ margin: 0 }}>Grievances</span></div>
        <p className="muted-note">No grievances on record. 🎉</p>
      </div>
    )
  }

  return (
    <div className="an2-chart">
      <div className="an2-chart-head">
        <span className="card-title" style={{ margin: 0 }}>Grievances</span>
        <button className="an-viewall" onClick={() => navigate('/grievances')}>View all →</button>
      </div>

      <div className="an-grv-stats">
        <div className="an-grv-stat"><div className="v">{total}</div><div className="k">Total</div></div>
        <div className="an-grv-stat tone-crit"><div className="v">{overdue.length}</div><div className="k">Overdue</div></div>
        <div className="an-grv-stat tone-warn"><div className="v">{open.length}</div><div className="k">Open</div></div>
        <div className="an-grv-stat tone-good"><div className="v">{resolved.length}</div><div className="k">Resolved</div></div>
      </div>

      <div className="an-row2" style={{ marginTop: '1rem' }}>
        <div>
          <div className="mono-label" style={{ marginBottom: '0.5rem' }}>OPEN BY REGION</div>
          {regionData.length === 0 ? <p className="muted-note">Nothing open.</p> : <HBars data={regionData} />}
        </div>
        <div>
          <div className="mono-label" style={{ marginBottom: '0.5rem' }}>OPEN BY CATEGORY</div>
          {categoryData.length === 0 ? <p className="muted-note">Nothing open.</p> : <HBars data={categoryData} alt />}
        </div>
      </div>

      <div className="mono-label" style={{ margin: '1.1rem 0 0.5rem' }}>MOST URGENT</div>
      <div className="an-alerts">
        {urgent.map((g) => (
          <button className="an-alert-row" key={g.id} onClick={() => navigate('/grievances', { state: { openId: g.id } })}>
            <span className={`an-alert-ic tone-${PRIORITY_TONE[g.priority]}`}><Icon name={g.isOverdue ? 'alert' : 'clock'} size={16} /></span>
            <span className="an-alert-body">
              <span className="an-alert-label">{g.distributor} — {g.subject}</span>
              <span className="an-alert-sub">{g.category} · {g.town} · {g.ageDays}d old{g.isOverdue ? ' · Overdue' : ''}</span>
            </span>
            <Pill tone={PRIORITY_TONE[g.priority]}>{g.priority}</Pill>
            <Icon name="chevronRight" size={14} />
          </button>
        ))}
      </div>
    </div>
  )
}

// The recurring gap types across the (filtered) book — "Where distributors are lacking".
function gapFreq(dbs: DbPerf[]): BarDatum[] {
  const n = dbs.length || 1
  return DB_GAP_CATEGORIES.map((c) => {
    const v = dbs.filter(c.test).length
    return { label: c.label, value: v, sub: `${Math.round((v / n) * 100)}% of DBs` }
  }).sort((a, b) => b.value - a.value)
}
// Worst-first — the specific DBs a user should look at, for "Which DB is lacking".
function needsAttentionList(dbs: DbPerf[]): DbPerf[] {
  return [...dbs].filter((d) => dbStatus(d) !== 'on_track')
    .sort((a, b) => dbAttainment(a) + dbCoverage(a) - (dbAttainment(b) + dbCoverage(b)))
}

/* ---------------- Turnover vs Target (single-axis combo: bars + target line) ---------------- */
function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

function TurnoverVsTarget({ dbs }: { dbs: DbPerf[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const months = TREND.map((t) => t.month)
  const monthly = months.map((_, i) => dbs.reduce((s, d) => s + (d.trend[i] ?? 0), 0))
  const targetTotal = dbs.reduce((s, d) => s + d.rcplTarget, 0)
  const attainment = monthly.map((v) => (targetTotal ? Math.round((v / targetTotal) * 100) : 0))

  const W = 460, H = 190, padL = 42, padR = 14, padT = 26, padB = 26
  const innerW = W - padL - padR, innerH = H - padT - padB
  const max = Math.max(targetTotal, ...monthly, 1) * 1.15
  const yFor = (v: number) => padT + (1 - v / max) * innerH
  const colW = innerW / months.length
  const barW = colW * 0.48
  const xCenter = (i: number) => padL + (i + 0.5) * colW
  const ticks = [0, 0.33, 0.66, 1].map((t) => Math.round(max * t))

  return (
    <div className="an2-chart">
      <div className="an2-chart-head">
        <span className="card-title" style={{ margin: 0 }}>Turnover vs Target Attainment</span>
      </div>
      <div className="chart-legend" style={{ marginBottom: '0.5rem' }}>
        <span className="lg"><span className="sw" style={{ background: 'var(--chart-1)' }} /> Turnover (₹L)</span>
        <span className="lg"><span className="sw" style={{ background: 'none', borderTop: '2px dashed var(--ink-mute)', width: 12, height: 0, borderRadius: 0 }} /> Target (₹L)</span>
      </div>
      <div className="an2-svgbox">
        <svg viewBox={`0 0 ${W} ${H}`} className="an2-svg" role="img" aria-label="Monthly turnover vs target">
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={padL + innerW} y1={yFor(t)} y2={yFor(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={padL - 8} y={yFor(t) + 4} textAnchor="end" fontSize={10} fill="var(--ink-mute)">{t}</text>
            </g>
          ))}
          <line x1={padL} x2={padL + innerW} y1={yFor(targetTotal)} y2={yFor(targetTotal)}
            stroke="var(--ink-mute)" strokeWidth={1.5} strokeDasharray="4 4" />
          <text x={padL + innerW} y={yFor(targetTotal) - 5} textAnchor="end" fontSize={9.5} fontWeight={700} fill="var(--ink-mute)">Target</text>

          {monthly.map((v, i) => {
            const x = xCenter(i) - barW / 2
            const y = yFor(v)
            const h = padT + innerH - y
            const attain = attainment[i]
            return (
              <g key={months[i]} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                <rect x={x - colW * 0.26} y={padT} width={barW + colW * 0.52} height={innerH} fill="transparent" />
                <path d={roundedTopBar(x, y, barW, h, 4)} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.45} />
                <text x={xCenter(i)} y={y - 8} textAnchor="middle" fontSize={10.5} fontWeight={800}
                  fill={attain >= 100 ? 'var(--good-text)' : 'var(--ink-mute)'}>{attain}%</text>
                <text x={xCenter(i)} y={padT + innerH + 18} textAnchor="middle" fontSize={10.5} fill="var(--ink-mute)">{months[i]}</text>
              </g>
            )
          })}
        </svg>
        {hover !== null && (
          <div className="line-tip" style={{ left: `${(xCenter(hover) / W) * 100}%`, top: `${(yFor(monthly[hover]) / H) * 100}%` }}>
            <div className="t-month">{months[hover]}</div>
            <div className="t-row"><span className="sw" style={{ background: 'var(--chart-1)' }} />Turnover<b>₹{monthly[hover]}L</b></div>
            <div className="t-row"><span className="sw" style={{ background: 'var(--ink-mute)' }} />Target<b>₹{targetTotal}L</b></div>
            <div className="t-row">Attainment<b>{attainment[hover]}%</b></div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- Top Movers (biggest gainers & decliners vs last month) ---------------- */
type MoverLens = 'attainment' | 'turnover'
const MOVER_LENSES: { key: MoverLens; label: string }[] = [
  { key: 'attainment', label: 'Attainment' },
  { key: 'turnover', label: 'Turnover' },
]
// Per-DB movement, straight off the 6-month turnover trend so the change is real, not fabricated:
//  - attainment: current attainment %, change = last-vs-prev month as pp of target
//  - turnover:   current ₹L, change = last-vs-prev month in ₹L
function moverFor(d: DbPerf, lens: MoverLens): { current: number; change: number; unit: string; barPct: number; max: number } {
  const last = d.trend[d.trend.length - 1] ?? 0
  const prev = d.trend[d.trend.length - 2] ?? last
  if (lens === 'attainment') {
    const change = d.rcplTarget ? Math.round(((last - prev) / d.rcplTarget) * 100) : 0
    return { current: dbAttainment(d), change, unit: 'pp', barPct: Math.min(100, dbAttainment(d)), max: 100 }
  }
  return { current: d.rcplTurnover, change: Math.round((last - prev) * 10) / 10, unit: '₹L', barPct: 0, max: 0 }
}

function TopMovers({ dbs }: { dbs: DbPerf[] }) {
  const navigate = useNavigate()
  const [lens, setLens] = useState<MoverLens>('attainment')
  const maxTurnover = Math.max(...dbs.map((d) => d.rcplTurnover), 1)

  const rows = dbs.map((d) => {
    const m = moverFor(d, lens)
    const barPct = lens === 'turnover' ? Math.min(100, (d.rcplTurnover / maxTurnover) * 100) : m.barPct
    return { d, ...m, barPct }
  })
  const gainers = [...rows].filter((r) => r.change > 0).sort((a, b) => b.change - a.change).slice(0, 3)
  const decliners = [...rows].filter((r) => r.change < 0).sort((a, b) => a.change - b.change).slice(0, 3)

  const Group = ({ title, list, up }: { title: string; list: typeof rows; up: boolean }) => (
    <div className="an-mv-group">
      <div className="an-mv-title">{title}</div>
      {list.length === 0 ? <p className="muted-note" style={{ margin: '0.2rem 0' }}>None this month.</p> : list.map((r) => (
        <button className="an-mv-row" key={r.d.id} onClick={() => navigate('/partners', { state: { query: r.d.name } })}>
          <span className="an-mv-name">{r.d.name}</span>
          <span className="an-mv-track"><i className={up ? 'up' : 'down'} style={{ width: `${r.barPct}%` }} /></span>
          <span className={`an-mv-chg ${up ? 'up' : 'down'}`}>{r.change > 0 ? '+' : ''}{r.change}{r.unit}</span>
          <span className="an-mv-cur">{lens === 'turnover' ? `₹${r.current}L` : `${r.current}%`}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="an2-chart">
      <div className="an2-chart-head">
        <span className="card-title" style={{ margin: 0 }}>Top Movers <span className="an-mv-sub">vs last month</span></span>
        <div className="an-mv-tabs">
          {MOVER_LENSES.map((l) => (
            <button key={l.key} className={`an-mv-tab ${lens === l.key ? 'on' : ''}`} onClick={() => setLens(l.key)}>{l.label}</button>
          ))}
        </div>
      </div>
      <Group title="Top gainers" list={gainers} up />
      <Group title="Top decliners" list={decliners} up={false} />
    </div>
  )
}

/* ---------------- Performance Heatmap (location × metric, color-graded cells) ----------------
   A classic grid heatmap: one row per location (state / town) or category, one column per
   metric, each cell shaded green→red by how the group scores. All values are averaged from the
   filtered `dbs`, so every cell is populated and the whole grid moves with the page filters. */
type HeatDim = 'region' | 'state' | 'town' | 'category'
const HEAT_DIMS: { key: HeatDim; label: string; head: string }[] = [
  { key: 'region', label: 'By region', head: 'Region' },
  { key: 'state', label: 'By state', head: 'State' },
  { key: 'town', label: 'By town', head: 'Town' },
  { key: 'category', label: 'By category', head: 'Category' },
]
const STATE_NAME: Record<string, string> = Object.fromEntries(GTM_STATES.map((s) => [s.code, s.name]))
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(GTM_STATES.map((s) => [s.name, s.code]))
const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)

// goodHigh: bigger is better (green when >= hi). risk is inverted (green when <= hi).
const HEAT_METRICS: { key: string; label: string; get: (r: DbPerf[]) => number; fmt: (v: number) => string; goodHigh: boolean; hi: number; lo: number }[] = [
  { key: 'cov', label: 'Coverage', get: (r) => avg(r.map(dbCoverage)), fmt: (v) => `${Math.round(v)}%`, goodHigh: true, hi: 90, lo: 70 },
  { key: 'fill', label: 'Fill rate', get: (r) => avg(r.map((d) => d.fillRate)), fmt: (v) => `${Math.round(v)}%`, goodHigh: true, hi: 92, lo: 85 },
  { key: 'attn', label: 'Attainment', get: (r) => avg(r.map(dbAttainment)), fmt: (v) => `${Math.round(v)}%`, goodHigh: true, hi: 100, lo: 85 },
  { key: 'growth', label: 'Growth MoM', get: (r) => avg(r.map((d) => d.growthMoM)), fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, goodHigh: true, hi: 3, lo: 0 },
  { key: 'risk', label: 'At risk', get: (r) => (r.filter((d) => dbStatus(d) === 'at_risk').length / (r.length || 1)) * 100, fmt: (v) => `${Math.round(v)}%`, goodHigh: false, hi: 0, lo: 25 },
]

function heatCell(value: number, m: (typeof HEAT_METRICS)[number]): { bg: string; fg: string } {
  const tier: 'good' | 'warn' | 'crit' = m.goodHigh
    ? (value >= m.hi ? 'good' : value >= m.lo ? 'warn' : 'crit')
    : (value <= m.hi ? 'good' : value <= m.lo ? 'warn' : 'crit')
  const VARS = { good: ['--good', '--good-text'], warn: ['--warn', '--warn-text'], crit: ['--crit', '--crit-text'] } as const
  const [c, t] = VARS[tier]
  return { bg: `color-mix(in srgb, var(${c}) 18%, transparent)`, fg: `var(${t})` }
}

/* ---------------- Activity Heatmap (GitHub-contributions style) ----------------
   A 52-week × 7-day contribution grid of distributor onboardings, coloured by how many were
   onboarded each day — straight off partners' real onboardedAt dates. Hover a cell for the count
   and date. Reads exactly like GitHub's commit graph. */
const GH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const GH_WD = ['', 'Mon', '', 'Wed', '', 'Fri', '']

function ActivityHeatmap() {
  const partners = useApp((s) => s.partners)
  const { weeks, monthLabels, total, maxCount } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of partners) {
      if (!p.onboardedAt) continue
      const d = new Date(p.onboardedAt)
      if (Number.isNaN(d.getTime())) continue
      counts.set(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, (counts.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? 0) + 1)
    }
    const today = new Date()
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const start = new Date(end)
    start.setDate(end.getDate() - 7 * 52)
    start.setDate(start.getDate() - start.getDay()) // rewind to the week's Sunday
    const weeks: { date: Date; count: number }[][] = []
    let total = 0, maxCount = 0
    const cur = new Date(start)
    while (cur <= end) {
      const col: { date: Date; count: number }[] = []
      for (let i = 0; i < 7; i++) {
        const within = cur <= end
        const c = within ? (counts.get(`${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`) ?? 0) : -1
        if (c > 0) { total += c; if (c > maxCount) maxCount = c }
        col.push({ date: new Date(cur), count: c })
        cur.setDate(cur.getDate() + 1)
      }
      weeks.push(col)
    }
    const monthLabels = weeks.map((w, i) => {
      const m = w[0].date.getMonth()
      return (i === 0 || m !== weeks[i - 1][0].date.getMonth()) ? GH_MONTHS[m] : ''
    })
    return { weeks, monthLabels, total, maxCount }
  }, [partners])

  const level = (c: number) => (c <= 0 ? 0 : maxCount <= 1 ? 2 : c >= 4 ? 4 : c >= 3 ? 3 : c >= 2 ? 2 : 1)
  const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="an-gh">
      <div className="an2-chart-head">
        <span className="card-title" style={{ margin: 0 }}>Onboarding Activity <span className="an-gh-sub">last 12 months</span></span>
        <span className="an-gh-total">{total} distributors onboarded</span>
      </div>
      <div className="an-gh-scroll">
        <div className="an-gh-months">
          {monthLabels.map((m, i) => <span key={i}>{m}</span>)}
        </div>
        <div className="an-gh-body">
          <div className="an-gh-wd">{GH_WD.map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="an-gh-grid">
            {weeks.map((w, wi) => (
              <div className="an-gh-col" key={wi}>
                {w.map((cell, di) => cell.count < 0
                  ? <span key={di} className="an-gh-cell empty" />
                  : <span key={di} className={`an-gh-cell l${level(cell.count)}`}
                      title={`${cell.count} onboarded · ${fmtDate(cell.date)}`} />)}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="an-gh-legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`an-gh-cell l${l}`} />)}
        <span>More</span>
      </div>
    </div>
  )
}

function PerformanceHeatmap({ dbs }: { dbs: DbPerf[] }) {
  const navigate = useNavigate()
  const [dim, setDim] = useState<HeatDim>('region')
  const groups = useMemo<{ label: string; rows?: DbPerf[]; vals?: Record<string, number>; count: number; nav: () => void }[]>(() => {
    // Region view: coverage from the live GTM plan (real for all 5 macro-regions) + the region
    // service/health rollups (REGION_PERFORMANCE), so every cell is populated. DBs = appointed
    // distributors in that region. Clicking a row drills into GTM Coverage for that region.
    if (dim === 'region') {
      const agg = new Map<GtmRegion, { actual: number; target: number }>()
      GTM_STATES.forEach((s) => {
        if (s.target == null || s.actual == null) return
        const r = REGION_OF[s.code]
        if (!r) return
        const cur = agg.get(r) ?? { actual: 0, target: 0 }
        cur.actual += s.actual; cur.target += s.target
        agg.set(r, cur)
      })
      return [...agg.entries()].map(([label, a]) => {
        const rp = REGION_PERFORMANCE[label]
        const cov = a.target ? Math.round((a.actual / a.target) * 100) : 0
        return {
          label,
          vals: { cov, fill: rp?.fillRate ?? 0, attn: rp?.attainmentPct ?? 0, growth: rp?.growthMoM ?? 0, risk: rp?.atRiskPct ?? 0 },
          count: a.actual,
          nav: () => navigate('/gtm-coverage', { state: { region: label } }),
        }
      }).sort((a, b) => (b.vals.cov ?? 0) - (a.vals.cov ?? 0))
    }
    const m = new Map<string, DbPerf[]>()
    for (const d of dbs) {
      const key = dim === 'state' ? (STATE_NAME[stateCodeForTown(d.town) ?? ''] ?? 'Other')
        : dim === 'town' ? d.town : d.category
      const arr = m.get(key) ?? []
      arr.push(d)
      m.set(key, arr)
    }
    const navFor = (label: string): (() => void) => {
      if (dim === 'town') return () => navigate('/partners', { state: { query: label } })
      if (dim === 'state') {
        const region = REGION_OF[NAME_TO_CODE[label] ?? '']
        return region ? () => navigate('/gtm-coverage', { state: { region } }) : () => navigate('/partners', { state: { query: label } })
      }
      return () => navigate('/partners', { state: { query: label } })
    }
    return [...m.entries()].map(([label, rows]) => ({ label, rows, count: rows.length, nav: navFor(label) }))
      .sort((a, b) => avg((b.rows ?? []).map(dbCoverage)) - avg((a.rows ?? []).map(dbCoverage)))
  }, [dbs, dim, navigate])
  const head = HEAT_DIMS.find((d) => d.key === dim)!.head

  return (
    <div className="an-heat">
      <div className="an2-chart-head">
        <span className="card-title" style={{ margin: 0 }}>Performance Heatmap</span>
        <div className="an-mv-tabs">
          {HEAT_DIMS.map((d) => (
            <button key={d.key} className={`an-mv-tab ${dim === d.key ? 'on' : ''}`} onClick={() => setDim(d.key)}>{d.label}</button>
          ))}
        </div>
      </div>
      {groups.length === 0 ? <p className="muted-note">No distributors match the current filters.</p> : (
        <div className="an-heat-wrap">
          <table className="an-heat-table">
            <thead>
              <tr>
                <th className="an-heat-rowh">{head}</th>
                {HEAT_METRICS.map((m) => <th key={m.key}>{m.label}</th>)}
                <th>DBs</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.label} className="an-heat-row" onClick={g.nav} title={`Open ${g.label}`}>
                  <td className="an-heat-rowh"><span className="an-heat-rowh-in">{g.label}<Icon name="chevronRight" size={13} /></span></td>
                  {HEAT_METRICS.map((m) => {
                    const v = g.vals ? g.vals[m.key] : (g.rows && g.rows.length ? m.get(g.rows) : null)
                    if (v == null) return <td key={m.key} className="an-heat-cell"><span className="an-heat-na">—</span></td>
                    const c = heatCell(v, m)
                    return <td key={m.key} className="an-heat-cell"><span style={{ background: c.bg, color: c.fg }}>{m.fmt(v)}</span></td>
                  })}
                  <td className="an-heat-count">{g.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="an-heat-legend">
        <span><i style={{ background: 'color-mix(in srgb, var(--good) 18%, transparent)' }} /> Strong</span>
        <span><i style={{ background: 'color-mix(in srgb, var(--warn) 18%, transparent)' }} /> Watch</span>
        <span><i style={{ background: 'color-mix(in srgb, var(--crit) 18%, transparent)' }} /> Weak</span>
        <span className="an-heat-legend-note">Cells shaded by score · averaged across DBs in view</span>
      </div>
    </div>
  )
}

/* ---------------- Advanced Chart (moneycontrol-style area + volume, hover crosshair) ----------------
   The "real-time analysis" chart: an area line of monthly book turnover with volume bars beneath
   (applications/month), a range switch (3M/6M) and a crosshair tooltip that reads out the exact
   turnover, change and volume at the hovered month. Built from the filtered `dbs` + TREND, so it
   moves with the page filters. */
type ChartRange = '3M' | '6M'

function AdvancedChart({ dbs }: { dbs: DbPerf[] }) {
  const [range, setRange] = useState<ChartRange>('6M')
  const [hover, setHover] = useState<number | null>(null)
  const gradId = useId()

  const allMonths = TREND.map((t) => t.month)
  const allTurnover = allMonths.map((_, i) => dbs.reduce((s, d) => s + (d.trend[i] ?? 0), 0))
  const allVolume = TREND.map((t) => t.total)
  const start = range === '3M' ? Math.max(0, allMonths.length - 3) : 0
  const months = allMonths.slice(start)
  const turnover = allTurnover.slice(start)
  const volume = allVolume.slice(start)
  const len = months.length || 1

  const latest = turnover[turnover.length - 1] ?? 0
  const prev = turnover[turnover.length - 2] ?? latest
  const change = Math.round((latest - prev) * 10) / 10
  const changePct = prev ? Math.round((change / prev) * 1000) / 10 : 0
  const up = change >= 0

  const W = 920, H = 300, padL = 46, padR = 18, padT = 18
  const innerW = W - padL - padR
  const priceH = 176, volH = 52, gap = 16
  const priceTop = padT, priceBottom = padT + priceH
  const volTop = priceBottom + gap, volBottom = volTop + volH
  const maxP = Math.max(...turnover) * 1.08
  const minP = Math.min(...turnover) * 0.92
  const yP = (v: number) => priceBottom - ((v - minP) / (maxP - minP || 1)) * priceH
  const maxV = Math.max(...volume, 1)
  const yV = (v: number) => volBottom - (v / maxV) * volH
  const xFor = (i: number) => (len === 1 ? padL + innerW / 2 : padL + (i / (len - 1)) * innerW)

  const linePts = turnover.map((v, i) => `${xFor(i)},${yP(v)}`).join(' ')
  const areaPath = `M${xFor(0)},${priceBottom} L${turnover.map((v, i) => `${xFor(i)},${yP(v)}`).join(' L')} L${xFor(len - 1)},${priceBottom} Z`
  const ticks = Array.from({ length: 5 }, (_, i) => minP + ((maxP - minP) / 4) * i)

  return (
    <div className="an-adv">
      <div className="an-adv-head">
        <div className="an-adv-title">
          <span className="an-adv-ic"><Icon name="analytics" size={15} /></span>
          <div>
            <div className="an-adv-name">Book Turnover · Monthly · ₹L</div>
            <div className="an-adv-quote">
              <span className="v">{latest}</span>
              <span className={up ? 'chg up' : 'chg down'}>{up ? '+' : ''}{change} ({up ? '+' : ''}{changePct}%)</span>
              <span className="an-adv-live"><span className="an-ai-dot" /> Live</span>
            </div>
          </div>
        </div>
        <div className="an-adv-tabs">
          {(['3M', '6M'] as ChartRange[]).map((r) => (
            <button key={r} className={`an-adv-tab ${range === r ? 'on' : ''}`} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>
      <div className="an2-svgbox" style={{ maxWidth: '100%' }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="an-adv-svg" role="img" aria-label="Book turnover advanced chart with volume">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ai)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--ai)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={padL + innerW} y1={yP(t)} y2={yP(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={padL - 8} y={yP(t) + 3} textAnchor="end" fontSize={10} fill="var(--ink-mute)">{Math.round(t)}</text>
            </g>
          ))}
          <path d={areaPath} fill={`url(#${gradId})`} />
          <polyline points={linePts} fill="none" stroke="var(--ai)" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
          {volume.map((v, i) => {
            // Cap the bar width and clamp each bar inside [padL, padL+innerW] so the edge
            // months (centred on the axis extremes) don't spill past the plot / off-card.
            const bw = Math.min(26, Math.max(6, (innerW / len) * 0.42))
            const bx = Math.max(padL, Math.min(xFor(i) - bw / 2, padL + innerW - bw))
            const vUp = i === 0 || turnover[i] >= turnover[i - 1]
            return <rect key={i} x={bx} y={yV(v)} width={bw} height={volBottom - yV(v)} rx={1.5}
              fill={vUp ? 'var(--good)' : 'var(--crit)'} opacity={hover === null || hover === i ? 0.55 : 0.25} />
          })}
          <text x={padL - 8} y={volTop + 4} textAnchor="end" fontSize={8.5} fill="var(--ink-mute)">Vol</text>
          {hover !== null && (
            <line x1={xFor(hover)} x2={xFor(hover)} y1={priceTop} y2={volBottom} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {turnover.map((v, i) => (
            <g key={months[i]}>
              <circle cx={xFor(i)} cy={yP(v)} r={hover === i ? 4.5 : 0} fill="var(--surface)" stroke="var(--ai)" strokeWidth={2} />
              <rect x={xFor(i) - innerW / len / 2} y={priceTop} width={innerW / len} height={volBottom - priceTop} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'crosshair' }} />
              <text x={xFor(i)} y={volBottom + 16} textAnchor="middle" fontSize={10.5} fontWeight={hover === i ? 700 : 400} fill={hover === i ? 'var(--ink)' : 'var(--ink-mute)'}>{months[i]}</text>
            </g>
          ))}
        </svg>
        {hover !== null && (() => {
          const d = hover > 0 ? Math.round((turnover[hover] - turnover[hover - 1]) * 10) / 10 : null
          return (
            <div className="line-tip" style={{ left: `${(xFor(hover) / W) * 100}%`, top: `${(yP(turnover[hover]) / H) * 100}%` }}>
              <div className="t-month">{months[hover]} 2026</div>
              <div className="t-row"><span className="sw" style={{ background: 'var(--ai)' }} />Turnover<b>₹{turnover[hover]}L</b></div>
              <div className="t-row">Change<b style={{ color: d == null ? 'var(--ink)' : d < 0 ? 'var(--crit-text)' : 'var(--good-text)' }}>{d == null ? '—' : `${d >= 0 ? '+' : ''}${d}L`}</b></div>
              <div className="t-row"><span className="sw" style={{ background: 'var(--good)' }} />Applications<b>{volume[hover]}</b></div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

/* ---------------- AI Insight (dynamic — computed from the live book) ----------------
   Moneycontrol-inspired financial-dashboard styling: a headline metric, a compact key-stat
   grid with green/red deltas, and a computed recommendation + "other insights". Everything
   here is derived from the currently-filtered `dbs` and the live grievances store, so it
   recomputes as data changes — nothing is a hardcoded string. */
interface InsightRow { name: string; sub: string; onClick: () => void }
interface InsightBullet { icon: IconName; tone: 'good' | 'warn' | 'crit' | 'ai'; text: string; rows?: InsightRow[] }

function AiInsight({ dbs }: { dbs: DbPerf[] }) {
  const navigate = useNavigate()
  const grievances = useApp((s) => s.grievances)
  const [detail, setDetail] = useState<{ title: string; rows: InsightRow[] } | null>(null)
  const n = dbs.length || 1

  const atRisk = dbs.filter((d) => dbStatus(d) === 'at_risk')
  const declining = dbs.filter((d) => d.growthMoM < 0)
  const lowFill = dbs.filter((d) => d.fillRate < 90)
  const improving = dbs.filter((d) => d.growthMoM >= 5)
  const overdue = grievances.filter((g) => g.isOverdue && g.status !== 'resolved')

  const targetTotal = dbs.reduce((s, d) => s + d.rcplTarget, 0)
  const turnoverTotal = dbs.reduce((s, d) => s + d.rcplTurnover, 0)
  const curAttain = targetTotal ? Math.round((turnoverTotal / targetTotal) * 100) : 0
  const avgCoverage = Math.round(dbs.reduce((s, d) => s + dbCoverage(d), 0) / n)
  const avgFill = Math.round(dbs.reduce((s, d) => s + d.fillRate, 0) / n)

  // Lowest-coverage macro-region, aggregated the same way the Coverage-by-Region card does.
  const regionAgg = new Map<GtmRegion, { actual: number; target: number }>()
  GTM_STATES.forEach((s) => {
    if (s.target == null || s.actual == null) return
    const region = REGION_OF[s.code]
    if (!region) return
    const cur = regionAgg.get(region) ?? { actual: 0, target: 0 }
    cur.actual += s.actual; cur.target += s.target
    regionAgg.set(region, cur)
  })
  const worstRegion = [...regionAgg.entries()]
    .map(([name, a]) => ({ name, pct: Math.round((a.actual / a.target) * 100) }))
    .sort((a, b) => a.pct - b.pct)[0]

  // Biggest single turnover drop this month, straight off the 6-month trend.
  const movers = dbs.map((d) => ({ d, delta: Math.round(((d.trend[d.trend.length - 1] ?? 0) - (d.trend[d.trend.length - 2] ?? 0)) * 10) / 10 }))
  const worstMover = [...movers].sort((a, b) => a.delta - b.delta)[0]

  // Headline recommendation — the single most pressing signal in the current book.
  const rec = (() => {
    if (atRisk.length) {
      const recovered = turnoverTotal + atRisk.reduce((s, d) => s + Math.max(0, d.rcplTarget - d.rcplTurnover), 0)
      const impactPp = (targetTotal ? Math.round((recovered / targetTotal) * 100) : 0) - curAttain
      const worst = [...atRisk].sort((a, b) => dbAttainment(a) - dbAttainment(b))[0]
      return {
        headline: `${atRisk.length} distributor${atRisk.length === 1 ? ' is' : 's are'} at risk — ${worst.name} is running ${dbAttainment(worst)}% of turnover plan and ${dbCoverage(worst)}% of coverage.`,
        action: 'Review at-risk distributors', route: '/partners' as const, query: worst.name,
        impact: impactPp > 0 ? `Recovering them to plan lifts book attainment by ~${impactPp}pp` : 'Priority: stop further slippage',
      }
    }
    if (worstRegion && worstRegion.pct < 70) {
      return {
        headline: `Coverage in the ${worstRegion.name} region is ${worstRegion.pct}% of plan — the weakest of all macro-regions this period.`,
        action: `Open ${worstRegion.name} coverage`, route: '/gtm-coverage' as const, query: undefined,
        impact: `Closing to 70% would add coverage across ${worstRegion.name}'s beats`,
      }
    }
    if (lowFill.length) {
      const worst = [...lowFill].sort((a, b) => a.fillRate - b.fillRate)[0]
      return {
        headline: `Fill rate is below 90% for ${lowFill.length} distributor${lowFill.length === 1 ? '' : 's'} — ${worst.name} is lowest at ${worst.fillRate}%.`,
        action: 'Review supply & stock', route: '/partners' as const, query: worst.name,
        impact: 'Service-level risk — check DC allocation before it hits orders',
      }
    }
    return {
      headline: `The book is healthy — ${curAttain}% attainment, ${avgCoverage}% coverage, no distributors at risk in view.`,
      action: 'View distributors', route: '/partners' as const, query: undefined,
      impact: 'Keep pressing the top movers to widen the lead',
    }
  })()

  // The specific entities behind each insight — so a bullet can open the exact list of who it's
  // about (e.g. which distributors are churning), not just state a count.
  const churnRows: InsightRow[] = [...declining].sort((a, b) => a.growthMoM - b.growthMoM).map((d) => ({
    name: d.name, sub: `${d.growthMoM}% MoM · ${dbAttainment(d)}% of plan · ${d.town}`,
    onClick: () => navigate('/partners', { state: { query: d.name } }),
  }))
  const overdueRows: InsightRow[] = overdue.map((g) => ({
    name: g.distributor, sub: `${g.subject} · ${g.ageDays}d old · ${g.town}`,
    onClick: () => navigate('/grievances', { state: { openId: g.id } }),
  }))
  const improvingRows: InsightRow[] = [...improving].sort((a, b) => b.growthMoM - a.growthMoM).map((d) => ({
    name: d.name, sub: `+${d.growthMoM}% MoM · ${dbAttainment(d)}% of plan · ${d.town}`,
    onClick: () => navigate('/partners', { state: { query: d.name } }),
  }))

  // Dynamic "other insights" — only the ones that actually apply right now. Each carries the
  // rows behind it, so clicking reveals exactly which distributors/grievances it's counting.
  const bullets: InsightBullet[] = [
    declining.length > 0 && ({ icon: 'clock', tone: 'warn', text: `${declining.length} distributor${declining.length === 1 ? '' : 's'} likely to churn — declining month-on-month`, rows: churnRows } as InsightBullet),
    overdue.length > 0 && ({ icon: 'flag', tone: 'crit', text: `${overdue.length} grievance${overdue.length === 1 ? '' : 's'} past SLA${overdue[0] ? ` — oldest is ${overdue[0].distributor}` : ''}`, rows: overdueRows } as InsightBullet),
    worstMover && worstMover.delta < 0 && ({ icon: 'analytics', tone: 'warn', text: `${worstMover.d.name} turnover down ₹${Math.abs(worstMover.delta)}L vs last month`, rows: [{ name: worstMover.d.name, sub: `Now ₹${worstMover.d.rcplTurnover}L · down ₹${Math.abs(worstMover.delta)}L · ${worstMover.d.town}`, onClick: () => navigate('/partners', { state: { query: worstMover.d.name } }) }] } as InsightBullet),
    improving.length > 0 && ({ icon: 'check', tone: 'good', text: `${improving.length} distributor${improving.length === 1 ? '' : 's'} growing 5%+ MoM — momentum to build on`, rows: improvingRows } as InsightBullet),
  ].filter((b): b is InsightBullet => !!b)

  // Moneycontrol-style key-stat grid — value + a colored delta, tabular figures.
  const stats: { label: string; value: string; delta?: string; tone: 'good' | 'warn' | 'crit' | 'neu' }[] = [
    { label: 'Book Attainment', value: `${curAttain}%`, tone: curAttain >= 100 ? 'good' : curAttain >= 85 ? 'warn' : 'crit' },
    { label: 'Avg Coverage', value: `${avgCoverage}%`, tone: avgCoverage >= 85 ? 'good' : avgCoverage >= 70 ? 'warn' : 'crit' },
    { label: 'Avg Fill Rate', value: `${avgFill}%`, tone: avgFill >= 90 ? 'good' : 'warn' },
    { label: 'At Risk', value: String(atRisk.length), delta: `${Math.round((atRisk.length / n) * 100)}% of book`, tone: atRisk.length === 0 ? 'good' : atRisk.length <= 2 ? 'warn' : 'crit' },
  ]

  return (
    <div className="an-ai">
      <div className="an-ai-head">
        <span className="an-ai-tag"><Icon name="spark" size={13} /> AI Insight</span>
        <span className="an-ai-live"><span className="an-ai-dot" /> Live</span>
      </div>

      <div className="an-ai-stats">
        {stats.map((s) => (
          <div className={`an-ai-stat tone-${s.tone}`} key={s.label}>
            <div className="an-ai-stat-label">{s.label}</div>
            <div className="an-ai-stat-val">{s.value}</div>
            {s.delta && <div className="an-ai-stat-delta">{s.delta}</div>}
          </div>
        ))}
      </div>

      <div className="an-ai-rec">
        <div className="an-ai-rec-body">
          <div className="an-ai-rec-headline">{rec.headline}</div>
          <div className="an-ai-rec-impact"><Icon name="target" size={12} /> {rec.impact}</div>
        </div>
        <Button size="sm" onClick={() => navigate(rec.route, rec.query ? { state: { query: rec.query } } : undefined)}>
          {rec.action} →
        </Button>
      </div>

      {bullets.length > 0 && (
        <div className="an-ai-other">
          <div className="an-ai-other-h">Other insights</div>
          {bullets.map((b, i) => (
            <button type="button" className={`an-ai-bullet tone-${b.tone} ${b.rows?.length ? 'clickable' : ''}`} key={i}
              disabled={!b.rows?.length}
              onClick={() => b.rows?.length && setDetail({ title: b.text, rows: b.rows })}>
              <span className="an-ai-bullet-ic"><Icon name={b.icon} size={13} /></span>
              <span className="an-ai-bullet-text">{b.text}</span>
              {!!b.rows?.length && <Icon name="chevronRight" size={14} />}
            </button>
          ))}
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? ''}>
        <div className="pt-breakdown">
          {(detail?.rows ?? []).length === 0 ? (
            <p className="muted-note">Nothing to show here right now.</p>
          ) : detail?.rows.map((r, i) => (
            <button key={i} className="pt-breakdown-row" onClick={() => { r.onClick(); setDetail(null) }}>
              <span className="pt-breakdown-main">
                <span className="n">{r.name}</span>
                <span className="t">{r.sub}</span>
              </span>
              <span className="pt-breakdown-metric"><Icon name="chevronRight" size={14} /></span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}

/* ---------------- Partner Aging (how long each distributor has been with RCPL) ---------------- */
const TENURE_BUCKETS = ['<1yr', '1-3yr', '3-5yr', '5yr+'] as const

// Sourced from the Partner directory (not DB_PERFORMANCE) so discontinued partners — who fall
// out of the "active DB performance" dataset entirely — still show up with their full tenure
// span, onboarded through to when they actually deboarded.
function PartnerAging() {
  const navigate = useNavigate()
  const allPartners = useApp((s) => s.partners)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const dataScopeByRole = useApp((s) => s.dataScopeByRole)
  const dataEntitiesByRole = useApp((s) => s.dataEntitiesByRole)
  const myScope = dataScopeByRole[viewingAs]
  const myRegion = DEMO_USERS[viewingAs]?.region
  const myState = DEMO_USERS[viewingAs]?.state
  const scopesPartners = (dataEntitiesByRole[viewingAs] ?? []).includes('partners')
  const isRegionScoped = myScope !== 'all' && scopesPartners
  const scoped = (isRegionScoped ? allPartners.filter((p) => inDataScope(p.state, myScope, myRegion, myState)) : allPartners)
    .filter((p): p is Partner & { onboardedAt: string } => !!p.onboardedAt)

  const [hover, setHover] = useState<number | null>(null)
  // Clicking a month pins its tooltip open — hover alone closed it the instant the cursor moved
  // toward a name inside it (or didn't work at all on touch), so the click list felt broken.
  const [pinned, setPinned] = useState<number | null>(null)
  // Tenure filter — narrows the chart (and its onboarded/deboarded lines) to one tenure band.
  // The stat strip always shows the full breakdown, with the active band highlighted.
  const [tenure, setTenure] = useState<'all' | (typeof TENURE_BUCKETS)[number]>('all')
  const active = pinned ?? hover
  const partners = tenure === 'all' ? scoped : scoped.filter((p) => tenureBucket(p.onboardedAt, p.discontinuedAt) === tenure)

  // Real 6-month onboarded-vs-deboarded history, straight off partners' own dates — same shape
  // as the Risks Trend dual-line chart, so hovering a month shows exactly who joined/left then.
  const months = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      return { label: d.toLocaleDateString('en-US', { month: 'short' }), year: d.getFullYear(), monthIdx: d.getMonth() }
    })
  }, [])
  const series = useMemo(() => months.map((m) => ({
    ...m,
    onboarded: partners.filter((p) => {
      const od = new Date(p.onboardedAt)
      return od.getFullYear() === m.year && od.getMonth() === m.monthIdx
    }),
    deboarded: partners.filter((p) => {
      if (!p.discontinuedAt) return false
      const dd = new Date(p.discontinuedAt)
      return dd.getFullYear() === m.year && dd.getMonth() === m.monthIdx
    }),
  })), [months, partners])

  // Taller than the other line charts (H 420 vs the usual 300) — this card sits next to AI
  // Insight, whose KPI strip + insight box + other-insights list run noticeably taller, so the
  // chart is sized to actually fill that space instead of leaving a bare gap under it.
  const W = 760, H = 420, padL = 40, padR = 22, padT = 30, padB = 34
  const innerW = W - padL - padR, innerH = H - padT - padB
  const maxV = Math.max(...series.map((s) => s.onboarded.length), ...series.map((s) => s.deboarded.length), 1) * 1.25
  const xFor = (i: number) => padL + (i * innerW) / (series.length - 1)
  const yFor = (v: number) => padT + (1 - v / maxV) * innerH
  const line = (key: 'onboarded' | 'deboarded') => series.map((s, i) => `${xFor(i)},${yFor(s[key].length)}`).join(' ')
  const ticks = [0, 0.5, 1].map((t) => Math.round(maxV * t))

  const gradId = useId()
  const bottom = padT + innerH
  const areaPath = (key: 'onboarded' | 'deboarded') => {
    const pts = series.map((s, i) => `${xFor(i)},${yFor(s[key].length)}`)
    return `M${padL},${bottom} L${pts.join(' L')} L${padL + innerW},${bottom} Z`
  }
  const hoveredSeries = active !== null ? series[active] : null

  return (
    <div className="an2-chart">
      <div className="an2-chart-head">
        <span className="card-title" style={{ margin: 0 }}>Partner Aging — onboarded vs deboarded</span>
        <div className="an-aging-controls">
          <div className="chart-legend">
            <span className="lg"><span className="sw" style={{ background: 'var(--crit)', borderRadius: '50%' }} /> Onboarded</span>
            <span className="lg"><span className="sw" style={{ background: 'var(--warn)', borderRadius: '50%' }} /> Deboarded</span>
          </div>
          <select className="mini-select" value={tenure} onChange={(e) => setTenure(e.target.value as typeof tenure)} aria-label="Filter by tenure">
            <option value="all">All tenure</option>
            {TENURE_BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>
      <div className="an-aging-box">
        <svg viewBox={`0 0 ${W} ${H}`} className="an-aging-svg" role="img" aria-label="Partners onboarded and deboarded per month">
          <defs>
            <linearGradient id={`${gradId}-on`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--crit)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--crit)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${gradId}-off`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--warn)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--warn)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={padL + innerW} y1={yFor(t)} y2={yFor(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={padL - 8} y={yFor(t) + 4} textAnchor="end" fontSize={10} fill="var(--ink-mute)">{t}</text>
            </g>
          ))}
          {active !== null && <line x1={xFor(active)} x2={xFor(active)} y1={padT} y2={padT + innerH} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3" />}
          <path d={areaPath('onboarded')} fill={`url(#${gradId}-on)`} />
          <path d={areaPath('deboarded')} fill={`url(#${gradId}-off)`} />
          <polyline points={line('onboarded')} fill="none" stroke="var(--crit)" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={line('deboarded')} fill="none" stroke="var(--warn)" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
          {series.map((s, i) => (
            <g key={`${s.year}-${s.monthIdx}`}>
              <circle cx={xFor(i)} cy={yFor(s.onboarded.length)} r={active === i ? 4.2 : 3.2} fill="var(--surface)" stroke="var(--crit)" strokeWidth={2} style={{ transition: 'r 0.1s' }} />
              <circle cx={xFor(i)} cy={yFor(s.deboarded.length)} r={active === i ? 4.2 : 3.2} fill="var(--surface)" stroke="var(--warn)" strokeWidth={2} style={{ transition: 'r 0.1s' }} />
              <rect x={xFor(i) - innerW / series.length / 2} y={padT} width={innerW / series.length} height={innerH} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                onClick={() => setPinned((p) => (p === i ? null : i))} style={{ cursor: 'pointer' }} />
              <text x={xFor(i)} y={padT + innerH + 18} textAnchor="middle" fontSize={10.5} fontWeight={active === i ? 700 : 400} fill={active === i ? 'var(--ink)' : 'var(--ink-mute)'}>{s.label}</text>
            </g>
          ))}
        </svg>
        {hoveredSeries && (
          <div className="line-tip an-tenure-tip" style={{ left: `${(xFor(active!) / W) * 100}%`, top: `${(Math.min(yFor(hoveredSeries.onboarded.length), yFor(hoveredSeries.deboarded.length)) / H) * 100}%`, pointerEvents: pinned !== null ? 'auto' : 'none' }}>
            <div className="t-month">
              {hoveredSeries.label} {hoveredSeries.year}
              {pinned !== null && <button className="an-tenure-tip-close" onClick={() => setPinned(null)} aria-label="Close">✕</button>}
            </div>
            <div className="t-row"><span className="sw" style={{ background: 'var(--crit)' }} />Onboarded<b>{hoveredSeries.onboarded.length}</b></div>
            <div className="an-tenure-tip-names">
              {hoveredSeries.onboarded.length === 0 ? <span className="an-tenure-tip-empty">None</span> : hoveredSeries.onboarded.map((p) => (
                <button key={p.id} className="an-tenure-tip-row" onClick={() => navigate('/partners', { state: { openId: p.id } })}>{p.legalName}</button>
              ))}
            </div>
            <div className="t-row"><span className="sw" style={{ background: 'var(--warn)' }} />Deboarded<b>{hoveredSeries.deboarded.length}</b></div>
            <div className="an-tenure-tip-names">
              {hoveredSeries.deboarded.length === 0 ? <span className="an-tenure-tip-empty">None</span> : hoveredSeries.deboarded.map((p) => (
                <button key={p.id} className="an-tenure-tip-row" onClick={() => navigate('/partners', { state: { openId: p.id } })}>{p.legalName}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <button className="an-viewall" style={{ marginTop: '0.6rem' }} onClick={() => navigate('/partners')}>View all distributors →</button>
    </div>
  )
}

/* ---------------- Key Alerts (computed from real data, not hardcoded) ---------------- */
interface AlertRow { icon: IconName; tone: 'crit' | 'warn' | 'good'; tag: string; label: string; sub: string; onClick: () => void }

function KeyAlerts({ dbs, grievances }: { dbs: DbPerf[]; grievances: Grievance[] }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)

  const lowCoverage = dbs.filter((d) => dbCoverage(d) < 40)
  const offTrack = dbs.filter((d) => dbStatus(d) !== 'on_track')
  const overdueGrievances = grievances.filter((g) => g.status !== 'resolved' && g.ageDays > 7)
  const declining = dbs.filter((d) => d.growthMoM < 0)
  const severeLowFill = dbs.filter((d) => d.fillRate < 80)

  const alerts: AlertRow[] = [
    lowCoverage.length > 0 && {
      icon: 'alert', tone: 'crit', tag: 'High',
      label: `${lowCoverage.length} distributor${lowCoverage.length === 1 ? '' : 's'} have coverage below 40%`,
      sub: 'Immediate attention required', onClick: () => navigate('/partners'),
    },
    offTrack.length > 0 && {
      icon: 'flag', tone: 'warn', tag: 'Medium',
      label: `${offTrack.length} distributor${offTrack.length === 1 ? '' : 's'} are off track on target attainment`,
      sub: 'Review and take action', onClick: () => navigate('/partners'),
    },
    overdueGrievances.length > 0 && {
      icon: 'documents', tone: 'warn', tag: 'Low',
      label: `${overdueGrievances.length} grievance${overdueGrievances.length === 1 ? '' : 's'} pending for more than 7 days`,
      sub: 'Follow up to avoid escalation', onClick: () => navigate('/grievances'),
    },
    declining.length > 0 && {
      icon: 'clock', tone: 'warn', tag: 'Medium',
      label: `${declining.length} distributor${declining.length === 1 ? '' : 's'} declining month-on-month`,
      sub: 'Investigate the drop before next quarter', onClick: () => navigate('/partners'),
    },
    severeLowFill.length > 0 && {
      icon: 'alert', tone: 'crit', tag: 'High',
      label: `${severeLowFill.length} distributor${severeLowFill.length === 1 ? '' : 's'} have fill rate below 80%`,
      sub: 'Service-level risk — review supply/stock', onClick: () => navigate('/partners'),
    },
  ].filter((a): a is AlertRow => !!a)

  const visible = expanded ? alerts : alerts.slice(0, 3)
  const TAG_TONE: Record<string, 'crit' | 'warn' | 'good'> = { High: 'crit', Medium: 'warn', Low: 'good' }

  return (
    <div>
      <div className="an-card-head">
        <span className="card-title" style={{ margin: 0 }}>Key Alerts</span>
        {alerts.length > 3 && (
          <button className="an-viewall" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '← Show less' : 'View all alerts →'}
          </button>
        )}
      </div>
      {alerts.length === 0 ? <p className="muted-note">No alerts right now — everything is tracking to plan. 🎉</p> : (
        <div className="an-alerts">
          {visible.map((a, i) => (
            <button className="an-alert-row" key={i} onClick={a.onClick}>
              <span className={`an-alert-ic tone-${a.tone}`}><Icon name={a.icon} size={16} /></span>
              <span className="an-alert-body">
                <span className="an-alert-label">{a.label}</span>
                <span className="an-alert-sub">{a.sub}</span>
              </span>
              <Pill tone={TAG_TONE[a.tag]}>{a.tag}</Pill>
              <Icon name="chevronRight" size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------------- Coverage by Region (mini India map + region list) ---------------- */
const REGION_TIER = (pct: number) => (pct >= 70 ? 'good' : pct >= 40 ? 'warn' : 'crit')
const REGION_COLOR: Record<string, string> = { good: 'var(--good)', warn: '#e0972a', crit: 'var(--crit)' }

function CoverageByRegion() {
  const navigate = useNavigate()
  const [hoverRegion, setHoverRegion] = useState<GtmRegion | null>(null)
  const regionAgg = new Map<GtmRegion, { actual: number; target: number }>()
  GTM_STATES.forEach((s) => {
    if (s.target == null || s.actual == null) return
    const region = REGION_OF[s.code]
    if (!region) return
    const cur = regionAgg.get(region) ?? { actual: 0, target: 0 }
    cur.actual += s.actual; cur.target += s.target
    regionAgg.set(region, cur)
  })
  const regions = [...regionAgg.entries()]
    .map(([name, a]) => ({ name, pct: Math.round((a.actual / a.target) * 100), actual: a.actual, target: a.target }))
    .sort((a, b) => b.pct - a.pct)
  const pctByCode = (code: string) => {
    const region = REGION_OF[code]
    const r = region && regionAgg.get(region)
    return r ? Math.round((r.actual / r.target) * 100) : null
  }
  const svgIdToCode = Object.fromEntries(Object.entries(SVG_ID).map(([code, id]) => [id, code]))

  return (
    <div className="an2-chart">
      <div className="an2-chart-head">
        <span className="card-title" style={{ margin: 0 }}>Coverage by Region</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span title="Average GTM coverage across all tracked states in each macro-region." style={{ color: 'var(--ink-mute)', cursor: 'help' }}>
            <Icon name="help" size={13} />
          </span>
          <button className="an-viewall" onClick={() => navigate('/gtm-coverage')}>View map →</button>
        </span>
      </div>
      <div className="an2-region-grid">
        <div className="an2-region-map">
          <svg viewBox={INDIA_MAP.viewBox} role="img" aria-label="Coverage by region">
            {INDIA_MAP.locations.map((loc: { id: string; name: string; path: string }) => {
              const code = svgIdToCode[loc.id]
              const pct = code ? pctByCode(code) : null
              const region = code ? REGION_OF[code] : undefined
              const fill = pct == null ? 'var(--surface-3)' : REGION_COLOR[REGION_TIER(pct)]
              const dim = hoverRegion && region !== hoverRegion
              return (
                <path key={loc.id} d={loc.path} fill={fill} stroke="var(--surface)" strokeWidth={0.8}
                  opacity={dim ? 0.35 : 1} style={{ transition: 'opacity 0.12s', cursor: region ? 'pointer' : 'default' }}
                  onClick={region ? () => navigate('/gtm-coverage', { state: { region } }) : undefined}>
                  <title>{`${loc.name}${pct != null ? ` — ${region}, ${pct}% coverage` : ''}`}</title>
                </path>
              )
            })}
          </svg>
        </div>
        <div className="an2-region-list">
          {regions.map((r) => (
            <button type="button" key={r.name} className="an2-region-row an2-region-row-btn"
              onMouseEnter={() => setHoverRegion(r.name)} onMouseLeave={() => setHoverRegion(null)}
              onClick={() => navigate('/gtm-coverage', { state: { region: r.name } })}>
              <span className="n">{r.name}</span>
              <span className="pct" style={{ color: REGION_COLOR[REGION_TIER(r.pct)] }}>{r.pct}%</span>
              <span className="bar"><i style={{ width: `${Math.min(100, r.pct)}%`, background: REGION_COLOR[REGION_TIER(r.pct)] }} /></span>
            </button>
          ))}
        </div>
      </div>
      <div className="an2-region-legend">
        <span><span className="sw" style={{ background: REGION_COLOR.good }} /> ≥ 70%</span>
        <span><span className="sw" style={{ background: REGION_COLOR.warn }} /> 40% – 69%</span>
        <span><span className="sw" style={{ background: REGION_COLOR.crit }} /> &lt; 40%</span>
      </div>
    </div>
  )
}


/* ---------------- Fill Rate vs Coverage (bubble scatter) ---------------- */
const STATUS_DOT: Record<DbStatus, string> = { on_track: 'var(--good)', watch: 'var(--warn)', at_risk: 'var(--crit)' }
const STATUS_LABEL: Record<DbStatus, string> = { on_track: 'On track', watch: 'Watch', at_risk: 'At risk' }

function FillVsCoverage({ dbs }: { dbs: DbPerf[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const W = 460, H = 260, padL = 40, padR = 16, padT = 16, padB = 34
  const innerW = W - padL - padR, innerH = H - padT - padB
  const xMin = 75, xMax = 100
  const covs = dbs.map(dbCoverage)
  const yMax = Math.max(100, Math.ceil((Math.max(...covs, 100) + 5) / 10) * 10)
  const maxOutlets = Math.max(...dbs.map((d) => d.outlets), 1)
  const xFor = (v: number) => padL + ((v - xMin) / (xMax - xMin)) * innerW
  const yFor = (v: number) => padT + (1 - v / yMax) * innerH
  const rFor = (outlets: number) => 5 + Math.sqrt(outlets / maxOutlets) * 13
  const xTicks = [75, 85, 95, 100]
  const yTicks = [0, yMax / 2, yMax]

  return (
    <div className="an2-chart">
      <div className="an2-chart-head"><span className="card-title" style={{ margin: 0 }}>Fill Rate vs Coverage</span></div>
      <div className="chart-legend" style={{ marginBottom: '0.5rem' }}>
        {(['on_track', 'watch', 'at_risk'] as DbStatus[]).map((s) => (
          <span className="lg" key={s}><span className="sw" style={{ background: STATUS_DOT[s], borderRadius: '50%' }} /> {STATUS_LABEL[s]}</span>
        ))}
      </div>
      <div className="an2-svgbox">
        <svg viewBox={`0 0 ${W} ${H}`} className="an2-svg" role="img" aria-label="Fill rate vs coverage by distributor">
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={padL + innerW} y1={yFor(t)} y2={yFor(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={padL - 8} y={yFor(t) + 4} textAnchor="end" fontSize={10} fill="var(--ink-mute)">{Math.round(t)}</text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={i} x={xFor(t)} y={padT + innerH + 18} textAnchor="middle" fontSize={10} fill="var(--ink-mute)">{t}%</text>
          ))}
          <text x={padL + innerW / 2} y={H - 2} textAnchor="middle" fontSize={10} fill="var(--ink-mute)">Fill rate (%)</text>
          {dbs.map((d) => {
            const cov = dbCoverage(d)
            const cx = xFor(d.fillRate), cy = yFor(cov), r = rFor(d.outlets)
            const dim = hover !== null && hover !== d.id
            const st = dbStatus(d)
            return (
              <g key={d.id} onMouseEnter={() => setHover(d.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                <circle cx={cx} cy={cy} r={r} fill={STATUS_DOT[st]} fillOpacity={dim ? 0.25 : 0.78}
                  stroke="var(--surface)" strokeWidth={2} style={{ transition: 'opacity 0.12s' }} />
                {/* selective direct label — only the at-risk (worst) DBs are named without hovering */}
                {st === 'at_risk' && (
                  <text x={cx} y={cy - r - 5} textAnchor="middle" fontSize={9} fontWeight={700}
                    fill="var(--crit-text)" opacity={dim ? 0.3 : 1}>{d.name}</text>
                )}
              </g>
            )
          })}
        </svg>
        {hover !== null && (() => {
          const d = dbs.find((x) => x.id === hover)!
          const cov = dbCoverage(d)
          const st = dbStatus(d)
          return (
            <div className="line-tip" style={{ left: `${(xFor(d.fillRate) / W) * 100}%`, top: `${(yFor(cov) / H) * 100}%` }}>
              <div className="t-month">{d.name}</div>
              <div className="t-row"><span className="sw" style={{ background: STATUS_DOT[st], borderRadius: '50%' }} />{STATUS_LABEL[st]}</div>
              <div className="t-row">Fill rate<b>{d.fillRate}%</b></div>
              <div className="t-row">Coverage<b>{cov}%</b></div>
              <div className="t-row">Outlets<b>{d.outlets.toLocaleString()}</b></div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

/* ==================================================================
   "Which DB is lacking" — reused by the overview (gapFreq / needsAttentionList above)
   ================================================================== */
const STATUS_META: Record<DbStatus, { label: string; tone: 'good' | 'warn' | 'crit' }> = {
  on_track: { label: 'On track', tone: 'good' },
  watch: { label: 'Watch', tone: 'warn' },
  at_risk: { label: 'At risk', tone: 'crit' },
}

function NeedsAttention({ dbs }: { dbs: DbPerf[] }) {
  if (dbs.length === 0) return <p className="muted-note">Every distributor is meeting plan. 🎉</p>
  return (
    <div className="needs-list">
      {dbs.slice(0, 5).map((d) => {
        const st = STATUS_META[dbStatus(d)]
        return (
          <div className="needs-item" key={d.id}>
            <div className="needs-main">
              <div className="needs-name">{d.name}<Pill tone={st.tone} dot>{st.label}</Pill></div>
              <div className="needs-meta">{d.town} · {d.category}</div>
              <div className="gap-chips">
                {dbGaps(d).map((g) => <span className="gap-chip" key={g}>{g}</span>)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- Horizontal bars ---------------- */
function HBars({ data, alt, showSub }: { data: BarDatum[]; alt?: boolean; showSub?: boolean }) {
  const max = Math.max(...data.map((d) => d.value))
  return (
    <div className="hbars">
      {data.map((d) => (
        <div className="hbar" key={d.label}>
          <div className="top">
            <span className="nm">{d.label}</span>
            <span className="vv">{d.value}{showSub && d.sub ? ` · ${d.sub}` : ''}</span>
          </div>
          <div className="track"><div className={`fill ${alt ? 'alt' : ''}`} style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

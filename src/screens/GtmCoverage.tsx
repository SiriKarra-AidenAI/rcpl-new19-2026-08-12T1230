import './GtmCoverage.css'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import type { IconName } from '../components/ui/icons'
import { GTM_STATES, GTM_FACTORS, GTM_DATA, actualDistributorsIn, distributorRowsIn, SVG_ID, stateCodeForTown, REGION_OF } from '../mock/gtm'
import type { GtmRegion, GtmStateInfo, StateDb } from '../mock/gtm'
import { DB_TYPES } from '../mock/onboarding'
import { DEMO_USERS } from '../mock/roles'
import { useApp } from '../store'
import INDIA_MAP from '@svg-maps/india'

// India has 28 states + 8 union territories — the fixed denominator for "States Covered".
const INDIA_STATE_COUNT = 36

const CHANNEL_COLOR: Record<string, string> = {
  'GT DB (with CSO/DSM)': 'var(--chart-1)', 'GM Excl DB': 'var(--chart-3)', Traders: 'var(--chart-5)',
}
const hashOf = (s: string) => s.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
// Deterministic "last activity" per distributor — same name+town always shows the same age.
const lastActivity = (d: StateDb) => {
  const days = 1 + (hashOf(d.name + d.town) % 12)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

const STATE_BY_SVG_ID: Record<string, GtmStateInfo | undefined> =
  Object.fromEntries(GTM_STATES.map((s) => [SVG_ID[s.code], s]))

/* ---- coverage tiers (per the India-overview legend) ---- */
type Tier = 'met' | 'high' | 'mid' | 'low' | 'none'
const tierOf = (s: GtmStateInfo): Tier => {
  if (s.target == null || s.actual == null) return 'none'
  const pct = (s.actual / s.target) * 100
  return pct >= 100 ? 'met' : pct >= 70 ? 'high' : pct >= 40 ? 'mid' : 'low'
}
const TIER_COLOR: Record<Tier, string> = {
  met: '#22b98a', high: '#e0c23c', mid: '#f09a4c', low: '#f16d6d', none: 'var(--surface-3)',
}
const TIER_LABEL: Record<Tier, string> = {
  met: '≥ 100%', high: '70% – 99%', mid: '40% – 69%', low: '< 40%', none: 'No data',
}
const pctOf = (s: GtmStateInfo) => (s.target && s.actual != null ? Math.round((s.actual / s.target) * 100) : null)

/* ---- factor rows for a state (deterministic — calibrated off the plan sheet ratios) ---- */
function factorRows(target: number, actual: number) {
  const r = actual / target
  return GTM_FACTORS.map((f) => {
    const t = f.money ? +(target * f.perTarget).toFixed(1) : Math.round(target * f.perTarget)
    const cov = Math.min(1.1, r + f.delta)
    const a = f.money ? +(t * cov).toFixed(1) : Math.round(t * cov)
    const variance = +(a - t).toFixed(1)
    const variancePct = t ? Math.abs(Math.round((variance / t) * 1000) / 10) : 0
    const coverage = t ? Math.round((a / t) * 100) : 0
    return { ...f, target: t, actual: a, variance, variancePct, coverage }
  })
}
const fmtVal = (v: number, money?: boolean) => (money ? `₹${v.toFixed(1)}L` : String(v))


export function GtmCoverage() {
  const navigate = useNavigate()
  const location = useLocation()
  const viewingAs = useApp((s) => s.viewingAs)
  const dataScopeByRole = useApp((s) => s.dataScopeByRole)
  const dataEntitiesByRole = useApp((s) => s.dataEntitiesByRole)
  // Data-level RBAC: a scoped persona (set by the Super Admin in Admin > Data access) only
  // sees — and can only select — states in their own region/state, but only if the Super
  // Admin has "GTM Coverage" checked as one of the screens that scope applies to.
  const myScope = viewingAs ? dataScopeByRole[viewingAs] : 'all'
  const myRegion = viewingAs ? DEMO_USERS[viewingAs]?.region : undefined
  const myState = viewingAs ? DEMO_USERS[viewingAs]?.state : undefined
  const scopesGtm = viewingAs ? (dataEntitiesByRole[viewingAs] ?? []).includes('gtm_coverage') : false
  const isRegionScoped = myScope !== 'all' && scopesGtm
  const partners = useApp((s) => s.partners)
  // "actual" is computed live from the same Partners directory the Partners screen itself
  // shows, instead of the ingested sheet's static count — so the two screens' numbers can
  // never drift apart (target stays the static plan figure; only actual is live).
  const allWithData = GTM_STATES
    .filter((s) => s.target != null && s.actual != null)
    .map((s) => ({ ...s, actual: actualDistributorsIn(partners, s.code) }))
  const withData = isRegionScoped
    ? allWithData.filter((s) => (myScope === 'own_state' ? s.name === myState : REGION_OF[s.code] === myRegion))
    : allWithData
  // "Coverage by Region" on Analytics links here with a region — narrows the state picker to
  // just that region's states so clicking e.g. "North" actually shows who's appointed there,
  // instead of landing on the same all-India view every other entry point lands on.
  const [regionFilter, setRegionFilter] = useState<GtmRegion | null>(null)
  useEffect(() => {
    const region = (location.state as { region?: GtmRegion } | null)?.region
    if (region) setRegionFilter(region)
  }, [location.state])
  const visibleStates = regionFilter ? withData.filter((s) => REGION_OF[s.code] === regionFilter) : withData
  const inScopeCodes = new Set(visibleStates.map((s) => s.code))
  // null = no single state chosen — the default, aggregate "all India" (or all-of-region, if a
  // region link narrowed visibleStates) view rather than defaulting to any one state.
  const [selected, setSelected] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [moreFactors, setMoreFactors] = useState(false)
  const [allStates, setAllStates] = useState(false)
  const [category, setCategory] = useState<string>('All')
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'In review'>('all')
  const [townFilter, setTownFilter] = useState<string | null>(null)
  const [showAllDbs, setShowAllDbs] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const distributorsRef = useRef<HTMLDivElement>(null)
  const factorsRef = useRef<HTMLDivElement>(null)
  const grievances = useApp((s) => s.grievances)
  const addReport = useApp((s) => s.addReport)
  const logAudit = useApp((s) => s.logAudit)

  // Constrained to `visibleStates` (RBAC-scoped, then optionally narrowed to one region), not
  // the raw GTM_STATES list, so a region-scoped persona — or a region link from Analytics —
  // can never land on, or stay on, a state outside what's actually visible right now.
  // No selection (the default) means "all India" — an aggregate pseudo-state summing every
  // visible state's target/actual, rather than silently falling back to visibleStates[0].
  const aggregateSel: GtmStateInfo = {
    code: 'ALL', name: regionFilter ? `All ${regionFilter}` : 'All India', col: 0, row: 0,
    target: visibleStates.reduce((s, x) => s + (x.target ?? 0), 0),
    actual: visibleStates.reduce((s, x) => s + (x.actual ?? 0), 0),
  }
  const sel = selected ? (visibleStates.find((s) => s.code === selected) ?? aggregateSel) : aggregateSel
  useEffect(() => {
    if (regionFilter && !visibleStates.some((s) => s.code === selected)) {
      setSelected(visibleStates[0]?.code ?? selected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionFilter])

  const ranked = [...visibleStates].sort((a, b) => (pctOf(b) ?? 0) - (pctOf(a) ?? 0))
  const topStates = allStates ? ranked : ranked.slice(0, 8)
  const rows = sel.target && sel.actual != null ? factorRows(sel.target, sel.actual).filter((f) => moreFactors || !f.extra) : []
  // City drill exists for states the state-level mock covers (MH, GJ, MP, RJ, UP) — never for
  // the aggregate "all India" pseudo-state, so this naturally hides that section there.
  const drill = GTM_DATA[sel.code]
  // Every state's appointed distributors — the real live Partners in it, not a synthetic
  // namedDbs+filler list, so this table/donut/city-drill always agrees with the actual count
  // above (and with the Partners screen itself).
  const distributorsForState = (s: GtmStateInfo): StateDb[] => distributorRowsIn(partners, s.code)
  // Aggregate mode flattens every visible state's own distributor list — not one call keyed by
  // the pseudo 'ALL' code, which stateDistributors/GTM_DATA don't know about.
  const stateDbs: StateDb[] = selected ? distributorsForState(sel) : visibleStates.flatMap(distributorsForState)
  // Category + status filters apply to the distributor table below and to the city drill-down
  // counts, so both stay in sync with whatever's actually listed rather than a separately-tracked
  // number. Town filter (from clicking a city) narrows the table only — city groupings are built
  // off category+status so every city still shows its own count.
  const catStatusDbs = stateDbs.filter((d) =>
    (category === 'All' || d.type === category) && (statusFilter === 'all' || d.status === statusFilter))
  const filteredDbs = townFilter ? catStatusDbs.filter((d) => d.town === townFilter) : catStatusDbs
  const dbsByTown = new Map<string, StateDb[]>()
  catStatusDbs.forEach((d) => dbsByTown.set(d.town, [...(dbsByTown.get(d.town) ?? []), d]))

  // Aggregate mode: any grievance whose town falls in a currently-visible state, not just a
  // single sel.code (the pseudo 'ALL' code matches nothing in the real per-town lookup).
  const stateGrievances = selected
    ? grievances.filter((g) => stateCodeForTown(g.town) === sel.code)
    : grievances.filter((g) => { const c = stateCodeForTown(g.town); return !!c && inScopeCodes.has(c) })

  const fullscreen = () => stageRef.current?.requestFullscreen?.()
  const scrollToDistributors = () => distributorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const exportView = () => {
    addReport({ name: `GTM Coverage export — ${sel.name}`, format: 'PDF' })
    logAudit({ actor: 'You', kind: 'human', action: `Exported GTM Coverage view (${sel.name}) to Reports`, entity: 'GTM Coverage' })
    navigate('/reports')
  }
  const goToDistributors = (patch?: { category?: string; status?: 'all' | 'Active' | 'In review'; town?: string | null }) => {
    if (patch?.category !== undefined) setCategory(patch.category)
    if (patch?.status !== undefined) setStatusFilter(patch.status)
    if (patch?.town !== undefined) setTownFilter((cur) => (cur === patch.town ? null : patch.town ?? null))
    scrollToDistributors()
  }

  // Channel-type split for the selected state's appointed distributors — feeds the donut.
  const channelCounts = DB_TYPES.map((t) => ({ type: t, count: stateDbs.filter((d) => d.type === t).length }))
    .filter((c) => c.count > 0)

  const selActive = stateDbs.filter((d) => d.status === 'Active').length
  const selInReview = stateDbs.filter((d) => d.status === 'In review').length
  const selNotActive = Math.max(0, (sel.target ?? 0) - stateDbs.length)
  const selPct = pctOf(sel) ?? 0

  const tiles: { icon: IconName; tone: string; label: string; big: string; sub: string; note: string; onClick: () => void }[] = [
    { icon: 'analytics', tone: 'ai', label: 'Coverage Achieved', big: `${selPct}%`, sub: '', note: `vs target 100%`,
      onClick: () => factorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { icon: 'partners', tone: 'ai', label: 'Total Distributors', big: String(stateDbs.length), sub: '', note: `across ${sel.name}`,
      onClick: () => goToDistributors({ category: 'All', status: 'all', town: null }) },
    { icon: 'check', tone: 'good', label: 'Active Distributors', big: String(selActive), sub: '', note: `${stateDbs.length ? Math.round((selActive / stateDbs.length) * 100) : 0}% of total`,
      onClick: () => goToDistributors({ status: 'Active' }) },
    { icon: 'clock', tone: 'warn', label: 'In Review', big: String(selInReview), sub: '', note: `${stateDbs.length ? Math.round((selInReview / stateDbs.length) * 100) : 0}% of total`,
      onClick: () => goToDistributors({ status: 'In review' }) },
    { icon: 'alert', tone: 'crit', label: 'Not Active', big: String(selNotActive), sub: '', note: 'short of plan',
      onClick: () => distributorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { icon: 'target', tone: 'ai', label: 'States Covered', big: `${withData.length} / ${INDIA_STATE_COUNT}`, sub: '', note: 'in India',
      onClick: () => stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
  ]

  return (
    <div>
      <div className="page-head">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: '0.8rem' }}>
          <div>
            <h1>GTM Coverage — {sel.name} <span className="page-info-ic" title="Real-time overview of distributor coverage and outreach performance."><Icon name="help" size={13} /></span></h1>
          </div>
          <div className="gtm-head-ctrl">
            <select className="mini-select" value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)}>
              <option value="">{regionFilter ? `All ${regionFilter}` : 'All India'}</option>
              {visibleStates.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
            <Button variant="ghost" onClick={exportView}><Icon name="download" size={14} /> Export</Button>
          </div>
        </div>
        {regionFilter && (
          <p className="muted-note" style={{ marginTop: '0.4rem' }}>
            <Icon name="target" size={12} /> Filtered to the <strong>{regionFilter}</strong> region — {visibleStates.length} state{visibleStates.length === 1 ? '' : 's'}, {visibleStates.reduce((n, s) => n + (s.actual ?? 0), 0)} distributors appointed.
            <button className="btn text sm" style={{ marginLeft: '0.5rem', padding: 0 }} onClick={() => setRegionFilter(null)}>Clear filter</button>
          </p>
        )}
      </div>

      {/* stat tiles */}
      <div className="gtm3-tiles gtm3-tiles6">
        {tiles.map((t) => (
          <button type="button" className="gtm3-tile gtm3-tile-btn" key={t.label} onClick={t.onClick}>
            <div>
              <div className="gtm3-tile-label">{t.label}</div>
              <div className="gtm3-tile-big">{t.big}</div>
              <div className="gtm3-tile-sub">{t.sub && <b>{t.sub}</b>} <span>{t.note}</span></div>
            </div>
            <span className={`gtm3-tile-ic tone-${t.tone}`}><Icon name={t.icon} size={16} /></span>
          </button>
        ))}
      </div>

      <div className="gtm4-row3">
        {/* choropleth map */}
        <Card className="gtm2-card">
          <div className="gtm2-fact-title" style={{ marginBottom: '0.6rem' }}>Coverage Heatmap</div>
          <div className="gtm3-map">
            <div className="gtm2-stage" ref={stageRef}>
              <div className="gtm2-zoom">
                <button title="Zoom in" onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.2).toFixed(1)))}>+</button>
                <button title="Zoom out" onClick={() => setZoom((z) => Math.max(1, +(z - 0.2).toFixed(1)))}>−</button>
                <button title="Fullscreen" onClick={fullscreen}>⛶</button>
              </div>
              <div className="gtm2-svgwrap">
                <svg viewBox={INDIA_MAP.viewBox} role="img" aria-label="India state coverage map"
                  style={{ transform: `scale(${zoom})` }}>
                  {INDIA_MAP.locations.map((loc: { id: string; name: string; path: string }) => {
                    const rawSt = STATE_BY_SVG_ID[loc.id]
                    // Out-of-region states render as "no data" and aren't clickable for a
                    // region-scoped persona — the data-level RBAC applies on the map too.
                    const st = rawSt && inScopeCodes.has(rawSt.code) ? rawSt : undefined
                    const tier: Tier = st ? tierOf(st) : 'none'
                    const pct = st ? pctOf(st) : null
                    const active = !!st && st.code === selected
                    return (
                      <path key={loc.id} d={loc.path} fill={TIER_COLOR[tier]}
                        className={`gtm4-path ${tier !== 'none' ? 'has' : ''} ${active ? 'active' : ''}`}
                        onClick={st && tier !== 'none' ? () => setSelected(st.code) : undefined}>
                        <title>{`${loc.name}${st && pct != null ? ` — ${st.actual}/${st.target} appointed (${pct}%)` : rawSt && isRegionScoped ? ' — outside your region' : ' — no data yet'}`}</title>
                      </path>
                    )
                  })}
                </svg>
              </div>
              <div className="gtm3-legend">
                <div className="gtm3-legend-title">Coverage</div>
                {(['met', 'high', 'mid', 'low', 'none'] as Tier[]).map((t) => (
                  <span className="row" key={t}><span className="swatch" style={{ background: TIER_COLOR[t] }} /> {TIER_LABEL[t]}</span>
                ))}
              </div>
            </div>
          </div>
          {/* selected-state summary strip — sits below the map, never covers it */}
          <div className="gtm4-summary">
            <div className="gtm4-summary-name">{sel.name}</div>
            <div className="gtm4-summary-row">
              <span>Coverage</span>
              <span className="bar"><i style={{ width: `${Math.min(100, selPct)}%`, background: TIER_COLOR[tierOf(sel)] }} /></span>
              <b>{selPct}%</b>
            </div>
            <div className="gtm4-summary-kvs">
              <span>Distributors <b>{stateDbs.length}</b></span>
              <span>Active <b>{selActive}</b></span>
              <span>In Review <b>{selInReview}</b></span>
              <span>Not Active <b>{selNotActive}</b></span>
            </div>
            <Button variant="ghost" size="sm" onClick={scrollToDistributors}>View Details →</Button>
          </div>
        </Card>

        {/* top states rail */}
        <Card className="gtm2-card">
          <div className="gtm2-gaps" style={{ marginTop: 0 }}>
            <div className="gtm2-gaps-head">
              <span>Top States by Coverage</span>
              <button className="btn text sm" style={{ padding: 0 }} onClick={() => setAllStates((v) => !v)}>
                {allStates ? 'Top 8' : 'View all'}
              </button>
            </div>
            {topStates.map((s) => {
              const pct = pctOf(s)!
              const tier = tierOf(s)
              return (
                <button className="gtm2-gap-row" key={s.code} onClick={() => setSelected(s.code)}>
                  <span className="n">{s.name}</span>
                  <span className="pct" style={{ background: 'transparent', color: TIER_COLOR[tier] }}>{pct}%</span>
                  <span className="bar"><i style={{ width: `${Math.min(100, pct)}%`, background: TIER_COLOR[tier] }} /></span>
                  <span className="cnt"><b>{s.actual}</b> / {s.target}</span>
                  <span className="go">›</span>
                </button>
              )
            })}
          </div>
        </Card>

        {/* channel-type donut for the selected state */}
        <Card className="gtm2-card">
          <div className="gtm2-fact-title" style={{ marginBottom: '0.6rem' }}>Coverage by Channel Type</div>
          {channelCounts.length === 0 ? (
            <p className="muted-note">No distributors appointed in {sel.name} yet.</p>
          ) : (
            <ChannelDonut counts={channelCounts} total={stateDbs.length}
              onSelect={(type) => goToDistributors({ category: type, status: 'all', town: null })} />
          )}
          <div className="gtm3-viewall">
            <Button variant="ghost" size="sm" onClick={() => navigate('/partners')}>View Channel Breakdown →</Button>
          </div>
        </Card>
      </div>

      {/* distributors appointed in the selected state — full width, since its 5-column table
          needs more room than a 3-across grid can spare it. */}
      <div ref={distributorsRef}>
        <Card className="gtm2-card">
          <div className="gtm2-fact-head" style={{ marginBottom: '0.6rem' }}>
            <div>
              <div className="gtm2-fact-title">Distributors in {sel.name}</div>
              <div className="gtm2-fact-sub">
                {filteredDbs.length} distributor{filteredDbs.length === 1 ? '' : 's'}
                {(statusFilter !== 'all' || townFilter) && (
                  <> · filtered{statusFilter !== 'all' ? ` · ${statusFilter}` : ''}{townFilter ? ` · ${townFilter}` : ''}
                    <button className="btn text sm" style={{ padding: 0, marginLeft: '0.4rem' }}
                      onClick={() => { setStatusFilter('all'); setTownFilter(null) }}>Clear</button>
                  </>
                )}
              </div>
            </div>
            <div className="gtm2-fact-ctrl">
              <select className="mini-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="All">All types</option>
                {DB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Button variant="ghost" size="sm" title="Export" onClick={exportView}><Icon name="download" size={13} /></Button>
            </div>
          </div>
          {filteredDbs.length === 0 ? (
            <p className="muted-note" style={{ margin: 0 }}>
              {stateDbs.length === 0
                ? `No distributors appointed in ${sel.name} yet — a whitespace the Lead Generation Agent can target.`
                : `No matching distributors appointed in ${sel.name}.`}
            </p>
          ) : (
            <div className="dtable-wrap" style={{ border: 'none' }}>
              <table className="dtable">
                <thead><tr><th>Distributor</th><th>Town</th><th>Type</th><th>Status</th><th>Last Activity</th></tr></thead>
                <tbody>
                  {(showAllDbs ? filteredDbs : filteredDbs.slice(0, 5)).map((d) => (
                    <tr key={`${d.name}-${d.town}`} className="clickable" onClick={() => navigate('/partners', { state: { query: d.name } })}>
                      <td className="strong">{d.name}</td>
                      <td>{d.town}</td>
                      <td>{d.type}</td>
                      <td>{d.status === 'Active' ? <Pill tone="good" dot>Active</Pill> : <Pill tone="warn" dot>In review</Pill>}</td>
                      <td className="gtm-nowrap">{lastActivity(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filteredDbs.length > 5 && (
            <div className="gtm3-viewall">
              <Button variant="ghost" size="sm" onClick={() => setShowAllDbs((v) => !v)}>
                {showAllDbs ? 'Show fewer' : `View all ${filteredDbs.length} distributors`} →
              </Button>
            </div>
          )}
        </Card>
      </div>

      <div className="gtm3-splitrow">
        {/* selected-state drill: cities where the mock has them — actual counts and distributor
            chips are computed from the (filtered) list above, not a separately-tracked number, so
            they can never drift out of sync with what's actually listed for this state. */}
        {drill && (
          <Card className="gtm2-card">
            <div className="gtm2-fact-head" style={{ marginBottom: '0.6rem' }}>
              <div>
                <div className="gtm2-fact-title">{sel.name} — City Drill-down</div>
                <div className="gtm2-fact-sub">
                  {category === 'All' ? 'Coverage vs appointed' : `Appointed ${category} distributors by city`}
                </div>
              </div>
            </div>
            <div className="gtm3-cities gtm3-cities-col">
              {Object.entries(drill.cities).map(([city, c]) => {
                const dbs = dbsByTown.get(city) ?? []
                const actual = dbs.length
                const pct = c.target ? Math.round((actual / c.target) * 100) : 0
                const tier = pct >= 100 ? 'met' : pct >= 70 ? 'high' : pct >= 40 ? 'mid' : 'low'
                return (
                  <button type="button" className={`gtm3-city gtm3-city-btn ${townFilter === city ? 'on' : ''}`} key={city}
                    onClick={() => goToDistributors({ town: city })}>
                    <div className="gtm3-city-head">
                      <span className="n">{city}</span>
                      <span className="c">
                        <b>{actual}</b>{category === 'All' && <> / {c.target}</>} <span style={{ color: TIER_COLOR[tier as Tier] }}>{pct}%</span>
                      </span>
                    </div>
                    <span className="bar"><i style={{ width: `${Math.min(100, pct)}%`, background: TIER_COLOR[tier as Tier] }} /></span>
                    {dbs.length > 0 && (
                      <div className="gtm3-city-dbs">
                        {dbs.length > 10
                          ? <span className="db db-count">{dbs.length} distributors</span>
                          : dbs.map((d) => <span className="db" key={d.name}>{d.name}{d.status === 'In review' ? ' · in review' : ''}</span>)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </Card>
        )}

        {/* grievances raised by distributors appointed in the selected state */}
        <Card className={`gtm2-card${drill ? '' : ' gtm-span2'}`}>
          <div className="gtm2-fact-head" style={{ marginBottom: '0.6rem' }}>
            <div className="gtm2-fact-title">Grievances in {sel.name}</div>
            <Pill tone={stateGrievances.some((g) => g.isOverdue) ? 'crit' : stateGrievances.length ? 'warn' : 'good'} dot>
              {stateGrievances.filter((g) => g.status !== 'resolved').length} Open
            </Pill>
          </div>
          {stateGrievances.length === 0 ? (
            <p className="muted-note" style={{ margin: 0 }}>No grievances on record for {sel.name}.</p>
          ) : (
            <div className="gtm3-grv-list">
              {stateGrievances.map((g) => (
                <button type="button" className="gtm3-grv-row gtm3-grv-btn" key={g.id}
                  onClick={() => navigate('/grievances', { state: { openId: g.id } })}>
                  <div>
                    <div className="strong">{g.subject}</div>
                    <div className="gtm2-f-sub">Raised by {g.distributor}</div>
                  </div>
                  <div className="gtm3-grv-meta">
                    <Pill tone={g.priority === 'high' ? 'crit' : g.priority === 'medium' ? 'warn' : 'good'} dot>{g.priority}</Pill>
                    {g.isOverdue ? <Pill tone="crit" dot>Overdue</Pill> : <Pill tone={g.status === 'resolved' ? 'good' : 'warn'} dot>{g.slaLabel}</Pill>}
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="gtm3-viewall">
            <Button variant="ghost" size="sm" onClick={() => navigate('/grievances')}>View all grievances →</Button>
          </div>
        </Card>
      </div>

      {/* GTM factors comparison for the selected state */}
      <div ref={factorsRef} />
      <Card className="gtm2-card">
        <div className="gtm2-fact-head">
          <div>
            <div className="gtm2-fact-title">GTM factors comparison — {sel.name} vs. plan</div>
            <div className="gtm2-fact-sub">Compare key GTM factors to understand gaps and priorities.</div>
          </div>
        </div>

        <div className="dtable-wrap" style={{ border: 'none' }}>
          <table className="dtable gtm2-ftable">
            <thead>
              <tr>
                <th>GTM factor</th>
                <th>{sel.name} (actual)</th>
                <th>Plan (target)</th>
                <th>Variance</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.key}>
                  <td>
                    <div className="gtm2-f">
                      <span className="gtm2-f-ic"><Icon name={f.icon as IconName} size={15} /></span>
                      <div>
                        <div className="gtm2-f-name">{f.label}</div>
                        <div className="gtm2-f-sub">{f.sub}</div>
                      </div>
                    </div>
                  </td>
                  <td><b className="gtm2-num">{fmtVal(f.actual, f.money)}</b><span className="gtm2-unit">{f.money ? 'approved' : 'appointed'}</span></td>
                  <td><b className="gtm2-num">{fmtVal(f.target, f.money)}</b><span className="gtm2-unit">target</span></td>
                  <td>
                    <span className={`gtm2-var ${f.variance >= 0 ? 'up' : 'down'}`}>
                      {f.variance >= 0 ? '↑' : '↓'} {f.money ? `₹${Math.abs(f.variance).toFixed(1)}L` : Math.abs(f.variance)} <span className="p">({f.variancePct}%)</span>
                    </span>
                  </td>
                  <td>
                    <div className="gtm2-cov">
                      <span className="bar"><i style={{ width: `${Math.min(100, f.coverage)}%`, background: f.coverage >= 100 ? 'var(--good)' : 'var(--crit)' }} /></span>
                      <span className="v">{f.coverage}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="gtm2-more">
          <Button variant="ghost" size="sm" onClick={() => setMoreFactors((v) => !v)}>
            {moreFactors ? 'Show fewer factors' : 'Show more factors'} <Icon name="chevronDown" size={12} />
          </Button>
        </div>
      </Card>
    </div>
  )
}

/* Coverage-by-channel-type donut for the selected state's appointed distributors. */
function ChannelDonut({ counts, total, onSelect }: { counts: { type: string; count: number }[]; total: number; onSelect: (type: string) => void }) {
  const R = 46, CX = 60, CY = 60, SW = 16
  const C = 2 * Math.PI * R
  let cursor = 0
  const segments = counts.map((c) => {
    const frac = total ? c.count / total : 0
    const len = Math.max(0, frac * C - (frac > 0 ? 2.5 : 0))
    const seg = { ...c, pct: Math.round(frac * 100), len, offset: -cursor * C }
    cursor += frac
    return seg
  })
  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg viewBox="0 0 120 120" width="100%" height="100%">
          <g transform={`rotate(-90 ${CX} ${CY})`}>
            <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--surface-3)" strokeWidth={SW} />
            {segments.map((s) => s.count > 0 && (
              <circle key={s.type} cx={CX} cy={CY} r={R} fill="none" stroke={CHANNEL_COLOR[s.type] ?? 'var(--ink-mute)'} strokeWidth={SW}
                strokeDasharray={`${s.len} ${C - s.len}`} strokeDashoffset={s.offset} strokeLinecap="butt" />
            ))}
          </g>
        </svg>
        <div className="center"><span className="n">{total}</span><span className="c">Total</span></div>
      </div>
      <div className="donut-legend">
        {segments.map((s) => (
          <button type="button" key={s.type} className="row donut-row-btn" onClick={() => onSelect(s.type)}>
            <span className="sw" style={{ background: CHANNEL_COLOR[s.type] ?? 'var(--ink-mute)' }} />
            <span className="nm">{s.type}</span>
            <span className="vv">{s.count} ({s.pct}%)</span>
          </button>
        ))}
      </div>
    </div>
  )
}

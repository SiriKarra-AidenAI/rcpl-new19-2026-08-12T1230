import './Partners.css'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Modal, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { Profile360 } from '../components/Profile360'
import type { Profile360Data } from '../components/Profile360'
import { useApp } from '../store'
import { grievancesFor } from '../mock/grievances'
import { DEMO_USERS } from '../mock/roles'
import { inDataScope } from '../lib/dataScope'
import { PARTNER_TYPE_COLOR, PARTNER_TYPES, partnerTypeLabel } from '../mock/templates'
import type { CandidateCard, Partner, PartnerTypeCode } from '../types'

// Ties a partner back to the same demo case shown in Approvals, so a nudge lands on the right thread.
const CASE_CODE_BY_PARTNER: Record<string, string> = { p2: 'CMP-2280', p3: 'VND-0417', p10: 'CMP-2291' }

function statusPill(s: Partner['status']) {
  if (s === 'active') return <Pill tone="good" dot>Active</Pill>
  if (s === 'discontinued') return <Pill tone="crit" dot>Discontinued</Pill>
  return <Pill tone="warn" dot>In review</Pill>
}

// Deterministic contact/registration details derived from the partner record, so each
// partner shows its own (stable) email, phone and GST rather than the same placeholder.
const STATE_GST_CODE: Record<string, string> = { MH: '27', GJ: '24', GA: '30' }
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const hashOf = (s: string) => s.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const slug = (s: string) => s.toLowerCase().replace(/\b(pvt|ltd|co|llp)\b/g, '').replace(/[^a-z0-9]+/g, '.').replace(/(^\.|\.$)/g, '')

function contactDetails(p: Partner): { label: string; value: string; icon?: import('../components/ui/icons').IconName }[] {
  const h = hashOf(p.legalName)
  // hashOf() returns an unsigned 32-bit hash (via `>>> 0`) that can exceed 2^31-1 — shifting it
  // with the signed `>>` reinterprets those larger hashes as negative, so `% 26` returns a
  // negative remainder and LETTERS[-n] reads back as undefined. `>>>` keeps every shift unsigned.
  const gst = `${STATE_GST_CODE[p.state] ?? '27'}${LETTERS[h % 26]}${LETTERS[(h >>> 3) % 26]}${LETTERS[(h >>> 6) % 26]}PD${1000 + (h % 9000)}${LETTERS[(h >>> 9) % 26]}1Z${h % 10}`
  const phone = `+91 9${String(8000000000 + (h % 1999999999)).slice(0, 9)}`
  return [
    { label: 'Contact person', value: `${LETTERS[h % 26]}. ${p.legalName.split(' ')[0]}`, icon: 'user' },
    { label: 'Email', value: `${slug(p.legalName)}@gmail.com`, icon: 'mail' },
    { label: 'Phone', value: phone, icon: 'comms' },
    { label: 'GST No.', value: gst, icon: 'documents' },
    { label: 'PAN', value: gst.slice(2, 12), icon: 'documents' },
    { label: 'Registration Type', value: 'Regular', icon: 'shield' },
  ]
}

const partnerId = (p: Partner) => `PT-${String(1000000 + (hashOf(p.id + p.legalName) % 8999999))}`

// Turn the profile's history strings into a newest-first timeline, tone-coded by keyword.
function toTimeline(history: string[]): { title: string; tone: 'crit' | 'warn' | 'good' | 'neutral' }[] {
  const tone = (s: string) => /discontinu|overdue|reject|terminat/i.test(s) ? 'crit'
    : /rout|warning|flag|shortfall|pending|review/i.test(s) ? 'warn'
    : /appoint|approv|renew|clear|active|onboard/i.test(s) ? 'good' : 'neutral'
  return [...history].reverse().map((h) => ({ title: h, tone: tone(h) as 'crit' | 'warn' | 'good' | 'neutral' }))
}

type Profile = Omit<Profile360Data, 'name' | 'color' | 'badges'>
// Keyed by DEMO_PARTNERS id (mock/cases.ts) — several tie back into the same demo cases
// shown in Approvals, so opening a partner's profile tells a consistent story.
const PROFILES: Record<string, Profile> = {
  p1: { // Surat Stockists — active, auto-cleared (CMP-2265)
    kpis: [{ label: 'Monthly sales', value: '₹95L' }, { label: 'Growth', value: '▲ 9%' }, { label: 'Outlets', value: '1,850' }, { label: 'Fill rate', value: '97%' }],
    trend: [70, 74, 78, 82, 88, 95],
    overview: 'Active General Trade distributor in Surat since 2022. Consistently exceeds the coverage plan across Gujarat; appointment auto-cleared at 95% confidence.',
    docs: [{ name: 'GST Certificate', status: 'verified' }, { name: 'FSSAI License', status: 'verified' }, { name: 'Godown Proof', status: 'verified' }],
    history: ['Appointed 18 Jun 2022 · auto-cleared', 'Renewal signed 22 Apr 2025'],
    agentLog: ['Evaluation Agent · auto-cleared (95%)', 'Document Intelligence · GST + FSSAI verified', 'Lead Generation Agent · matched to Surat coverage plan'],
  },
  p2: { // Deccan Trade Links — in review (CMP-2280, routed to Channel Development)
    kpis: [{ label: 'Projected sales', value: '₹34L' }, { label: 'Growth', value: 'New' }, { label: 'Outlets planned', value: '960' }, { label: 'Status', value: 'In review' }],
    trend: [0.4, 0.5, 0.5, 0.6, 0.6, 0.7],
    overview: 'New DB application for Nagpur — currently CMP-2280 in the Approvals queue, routed to Channel Development after infra & coverage scored below the territory threshold.',
    docs: [{ name: 'GST Certificate', status: 'not_checked' }, { name: 'DB Onboarding Form', status: 'not_checked' }],
    history: ['Application submitted · new DB', 'Routed to Channel Development for infra review'],
    agentLog: ['Recommendation Engine · ranked top candidate for Nagpur', 'Evaluation Agent · flagged Channel Management Evaluation'],
  },
  p3: { // Krishna Packaging — in review (VND-0417, routed to MDM)
    kpis: [{ label: 'Projected supply value', value: '₹18L' }, { label: 'On-time delivery', value: 'New' }, { label: 'Facilities', value: '1' }, { label: 'Status', value: 'In review' }],
    trend: [0.3, 0.35, 0.4, 0.4, 0.45, 0.5],
    overview: 'Vendor onboarding in review — VND-0417 is pending MDM document verification, with 2 of 6 required documents still missing.',
    docs: [{ name: 'ISO 9001', status: 'verified' }, { name: 'GST', status: 'not_checked' }, { name: 'Factory Audit Report', status: 'not_checked' }],
    history: ['Application submitted · new Vendor', 'Routed to MDM for document check'],
    agentLog: ['Evaluation Agent · document set incomplete', 'MDM · document check pending'],
  },
  p4: { // Ganesh Distributors — discontinued
    kpis: [{ label: 'Monthly sales', value: '₹0' }, { label: 'Growth', value: '▼ discontinued' }, { label: 'Outlets (last known)', value: '640' }, { label: 'Status', value: 'Discontinued' }],
    trend: [1.6, 1.3, 1.1, 0.9, 0.4, 0],
    overview: 'Discontinued distributor in Kolhapur — declining sales and poor retailer relations, replaced under an approved Discontinuation Form.',
    docs: [{ name: 'GST Certificate', status: 'verified' }, { name: 'DB Onboarding Form', status: 'verified' }],
    history: ['Appointed 2019', 'Discontinuation Form approved · replaced 2026'],
    agentLog: ['Evaluation Agent · previously auto-cleared', 'Compliance Agent · discontinuation processed'],
  },
  p5: { // Coastal Logistics Co — active
    kpis: [{ label: 'Monthly deliveries', value: '3,200' }, { label: 'On-time rate', value: '96%' }, { label: 'Fleet size', value: '42 vehicles' }, { label: 'Coverage', value: 'Goa + South MH' }],
    trend: [58, 62, 68, 74, 80, 88],
    overview: 'Active logistics partner covering Goa and southern Maharashtra since 2021 — the primary carrier for coastal routes, with strong on-time delivery.',
    docs: [{ name: 'GST', status: 'verified' }, { name: 'Fleet Registration', status: 'verified' }, { name: 'Insurance', status: 'verified' }],
    history: ['Appointed 2021', 'Insurance renewed Jan 2026'],
    agentLog: ['Evaluation Agent · auto-cleared', 'Document Intelligence · fleet + insurance verified'],
  },
  p6: { // Malhotra Distributors — active, no open case
    kpis: [{ label: 'Monthly sales', value: '₹96L' }, { label: 'Growth', value: '▲ 3%' }, { label: 'Outlets', value: '980' }, { label: 'Fill rate', value: '92%' }],
    trend: [88, 90, 91, 93, 95, 96],
    overview: 'Malhotra Distributors is an active GT distributor in Nashik — steady performance, no open onboarding case.',
    docs: [{ name: 'GST Certificate', status: 'verified' }, { name: 'FSSAI License', status: 'verified' }],
    history: ['Appointed 2023 · auto-cleared', 'Renewal current'],
    agentLog: ['Evaluation Agent · auto-cleared', 'Document Intelligence · GST + FSSAI verified'],
  },
  // Active DBs that also appear in the Grievances queue.
  p7: {
    kpis: [{ label: 'Monthly sales', value: '₹78L' }, { label: 'Growth', value: '▲ 12%' }, { label: 'Outlets', value: '1,050' }, { label: 'Fill rate', value: '93%' }],
    trend: [58, 62, 66, 70, 74, 78],
    overview: 'Godavari Traders is an active GT distributor in Nashik — strong beat coverage in Nashik Rural, expanding into an additional beat.',
    docs: [{ name: 'GST Certificate', status: 'verified' }, { name: 'FSSAI License', status: 'verified' }],
    history: ['Appointed 2023 · auto-cleared', 'Renewal current'],
    agentLog: ['Evaluation Agent · auto-cleared', 'Document Intelligence · GST + FSSAI verified'],
  },
  p8: {
    kpis: [{ label: 'Monthly sales', value: '₹64L' }, { label: 'Growth', value: '▲ 6%' }, { label: 'Outlets', value: '820' }, { label: 'Fill rate', value: '91%' }],
    trend: [55, 57, 60, 61, 63, 64],
    overview: 'Deshmukh Enterprises is an active distributor in Aurangabad with steady month-on-month growth.',
    docs: [{ name: 'GST Certificate', status: 'verified' }, { name: 'FSSAI License', status: 'verified' }],
    history: ['Appointed 2022 · auto-cleared', 'Renewal current'],
    agentLog: ['Evaluation Agent · auto-cleared', 'Document Intelligence · GST + FSSAI verified'],
  },
  p9: {
    kpis: [{ label: 'Monthly sales', value: '₹110L' }, { label: 'Growth', value: '▲ 15%' }, { label: 'Outlets', value: '1,380' }, { label: 'Fill rate', value: '96%' }],
    trend: [72, 80, 88, 96, 103, 110],
    overview: 'Andheri General Stores is a high-performing distributor in West Mumbai — one of the strongest metro DBs.',
    docs: [{ name: 'GST Certificate', status: 'verified' }, { name: 'FSSAI License', status: 'verified' }],
    history: ['Appointed 2021 · auto-cleared', 'Renewal current'],
    agentLog: ['Evaluation Agent · auto-cleared', 'Document Intelligence · GST + FSSAI verified'],
  },
  p10: { // Suvarna Agencies — in review (CMP-2291, replacement DB, flagged to Finance)
    kpis: [{ label: 'Monthly turnover', value: '₹120L' }, { label: 'Financial Evaluation', value: '82%' }, { label: 'Coverage', value: '1,200 outlets' }, { label: 'Status', value: 'Pending Finance' }],
    trend: [96, 102, 108, 112, 116, 120],
    overview: 'Replacement distributor for Nashik — CMP-2291 is with Finance after the Financial Evaluation came in at 82% vs. the 100% required (Channel Management Evaluation passed).',
    docs: [{ name: 'GST Certificate', status: 'verified' }, { name: 'DB Onboarding Form', status: 'pending' }, { name: 'Godown Proof', status: 'not_checked' }, { name: 'FSSAI License', status: 'not_checked' }],
    history: ['Application submitted · replacement DB', 'Channel Management Evaluation passed', 'Routed to Finance — funds shortfall vs. required investment'],
    agentLog: ['Recommendation Engine · ranked top candidate for Nashik', 'Evaluation Agent · flagged Financial Evaluation', 'Communication Agent · notified assigned ASM'],
  },
  p11: {
    kpis: [{ label: 'Monthly sales', value: '₹58L' }, { label: 'Growth', value: '▲ 4%' }, { label: 'Outlets', value: '760' }, { label: 'Fill rate', value: '90%' }],
    trend: [50, 52, 54, 55, 57, 58],
    overview: 'Juhu Distributors is an active distributor in West Mumbai with stable performance.',
    docs: [{ name: 'GST Certificate', status: 'verified' }, { name: 'FSSAI License', status: 'verified' }],
    history: ['Appointed 2022 · auto-cleared', 'Renewal current'],
    agentLog: ['Evaluation Agent · auto-cleared', 'Document Intelligence · GST + FSSAI verified'],
  },
}
const DEFAULT_PROFILE: Profile = {
  kpis: [{ label: 'Projected sales', value: 'Pending scorecard' }, { label: 'Growth', value: 'New' }, { label: 'Outlets', value: 'Pending survey' }, { label: 'Status', value: 'In progress' }],
  trend: [0.6, 0.8, 0.9, 1.0, 1.1, 1.2],
  overview: 'Onboarding in progress — full performance history begins once the distributor is live.',
  docs: [{ name: 'GST Certificate', status: 'not_checked' }],
  history: ['Application submitted · in review'],
  agentLog: ['Recommendation Engine · ranked candidate', 'Evaluation Agent · scored 2 forks'],
}

// A partner promoted straight from the candidate pipeline (id `candidate:<candidateId>`) has no
// entry in the hand-authored PROFILES map — build a real one from its actual evaluation numbers
// instead of falling back to DEFAULT_PROFILE's generic "Pending" placeholders.
function buildCandidateProfile(c: CandidateCard): Profile {
  const trend = [0.5, 0.65, 0.8, 0.9, 0.95, 1].map((f) => Math.round(c.turnoverMonthly * f))
  return {
    kpis: [
      { label: 'Monthly turnover', value: `₹${c.turnoverMonthly}L` },
      { label: 'Growth', value: '▲ New' },
      { label: 'Outlets', value: c.coverageOutlets.toLocaleString() },
      { label: 'Status', value: 'Active' },
    ],
    trend,
    overview: `Newly onboarded ${c.dbCategory} distributor in ${c.town} — cleared Financial Evaluation (${c.finEvalPct}%) and Channel Management Evaluation (${c.infraScore.toFixed(1)}/10), then Leadership sign-off. Expected RCPL turnover ₹${c.expectedRcplTurnover}L/mo.`,
    docs: [{ name: 'GST Certificate', status: 'verified' }, { name: 'DB Onboarding Form', status: 'verified' }],
    history: ['Application submitted', `Evaluation Agent · Financial ${c.finEvalPct}% · Infra ${c.infraScore.toFixed(1)}/10`, 'Approved by Finance/Channel Development', 'Leadership sign-off · appointed'],
    agentLog: ['Recommendation Engine · ranked candidate', 'Evaluation Agent · scored evaluation', 'Leadership · final sign-off approved'],
  }
}

// Parse the (string) sales / growth off a partner's profile for the row + summary rollups.
const salesLakh = (id: string, profiles: Record<string, Profile>): number => {
  const m = profiles[id]?.kpis[0]?.value.match(/₹\s*([\d,.]+)\s*L/i)
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0
}
const fmtCr = (lakh: number) => (lakh >= 100 ? `₹${(lakh / 100).toFixed(2)}Cr` : `₹${lakh}L`)
const growthOf = (id: string, profiles: Record<string, Profile>): { pct: number | null; raw: string } => {
  const raw = profiles[id]?.kpis[1]?.value ?? '—'
  const m = raw.match(/([▲▼])\s*([\d.]+)\s*%/)
  return { pct: m ? (m[1] === '▼' ? -1 : 1) * parseFloat(m[2]) : null, raw }
}
const initialsOf = (s: string) => s.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

// ---- "Why this number" breakdowns for a partner-profile KPI tile ----
// Splits a KPI's numeric value into deterministic named contributors (same partner+label
// always splits the same way), so clicking a tile like "Monthly sales ₹95L" shows what
// actually makes it up instead of the figure just sitting there unexplained.
const STAPLE_CATEGORIES = ['Wheat Flour (Atta)', 'Rice', 'Pulses & Dal', 'Edible Oil', 'Sugar & Salt']
const VENDOR_SUPPLY_LINES = ['Packaging materials', 'Raw film & laminates', 'Caps & closures', 'Corrugated boxes']
const OUTLET_TYPES = ['General Trade', 'Modern Trade', 'Wholesale', 'Institutional']
const ROUTE_TYPES = ['Core town beats', 'Rural beats', 'Highway / transit routes', 'New routes (last 90 days)']
const FLEET_TYPES = ['Trucks (6+ ton)', 'Mini-trucks', 'Delivery vans']

function parseNum(value: string): { prefix: string; num: number; suffix: string; commas: boolean } | null {
  const m = value.match(/^([^\d]*)([\d,]+(?:\.\d+)?)(.*)$/)
  if (!m) return null
  return { prefix: m[1], num: parseFloat(m[2].replace(/,/g, '')), suffix: m[3], commas: m[2].includes(',') }
}
function fmtLike(n: number, ref: NonNullable<ReturnType<typeof parseNum>>): string {
  const rounded = Number.isInteger(ref.num) ? Math.round(n) : +n.toFixed(1)
  const numStr = ref.commas ? rounded.toLocaleString('en-IN') : String(rounded)
  return `${ref.prefix}${numStr}${ref.suffix}`
}
// Deterministic weighted split of `total` across `names`, seeded by a stable string so the
// same partner + KPI always shows the same breakdown.
function splitAmount(seed: string, names: string[]): { label: string; share: number }[] {
  const h = hashOf(seed)
  const weights = names.map((_, i) => 1 + ((h >> (i * 3)) % 5))
  const sum = weights.reduce((a, b) => a + b, 0)
  return names.map((label, i) => ({ label, share: weights[i] / sum }))
}

interface KpiBreakdownRow { label: string; value: string; sub?: string }
function kpiBreakdown(k: { label: string; value: string }, p: Partner, trend: number[]): KpiBreakdownRow[] | undefined {
  const lbl = k.label.toLowerCase()
  const seed = p.id + k.label
  const isLogistics = p.partnerType === 'logistics'

  if (/growth/.test(lbl)) {
    if (trend.length < 2) return undefined
    const prev = trend[trend.length - 2], cur = trend[trend.length - 1]
    const deltaPct = prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : 0
    return [
      { label: 'Last month', value: `₹${prev}L` },
      { label: 'This month', value: `₹${cur}L` },
      { label: 'Net change', value: `${deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(deltaPct)}%`, sub: 'vs last month' },
    ]
  }

  const parsed = parseNum(k.value)
  if (/fill rate|on-time/.test(lbl) && parsed) {
    const base = 800 + (hashOf(seed) % 900)
    const good = Math.round((base * parsed.num) / 100)
    return [
      { label: isLogistics ? 'Deliveries scheduled' : 'Orders placed', value: base.toLocaleString('en-IN') },
      { label: isLogistics ? 'Delivered on time' : 'Fulfilled in full', value: good.toLocaleString('en-IN') },
      { label: isLogistics ? 'Delayed' : 'Short-supplied / stock-out', value: (base - good).toLocaleString('en-IN'), sub: `${(100 - parsed.num).toFixed(0)}% of ${isLogistics ? 'deliveries' : 'orders'}` },
    ]
  }

  if (!parsed || !Number.isFinite(parsed.num) || parsed.num <= 0) return undefined
  const buckets =
    /sales|turnover|supply value/.test(lbl) ? (p.partnerType === 'vendor' ? VENDOR_SUPPLY_LINES : STAPLE_CATEGORIES)
    : /outlet|coverage/.test(lbl) ? OUTLET_TYPES
    : /deliver/.test(lbl) ? ROUTE_TYPES
    : /fleet/.test(lbl) ? FLEET_TYPES
    : null
  if (!buckets) return undefined
  return splitAmount(seed, buckets).map(({ label, share }) => ({
    label, value: fmtLike(parsed.num * share, parsed), sub: `${Math.round(share * 100)}%`,
  }))
}

// Which summary stat tile is open in the "what makes up this number" breakdown.
type StatKey = 'total' | 'active' | 'review' | 'disc' | 'sales' | 'growth'

export function Partners() {
  const navigate = useNavigate()
  const location = useLocation()
  const [filter, setFilter] = useState<PartnerTypeCode | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Default to Active — Discontinued/In review partners are still one click away via Filters,
  // but the directory shouldn't open on a mix of live and dead partners by default.
  const [statusFilter, setStatusFilter] = useState<Partner['status'] | 'all'>('active')
  const [stateFilter, setStateFilter] = useState<string>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [breakdown, setBreakdown] = useState<StatKey | null>(null)
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const setCopilotOpen = useApp((s) => s.setCopilotOpen)
  const grievances = useApp((s) => s.grievances)
  const nudgePartner = useApp((s) => s.nudgePartner)
  const removePartner = useApp((s) => s.removePartner)
  const serveTerminationNotice = useApp((s) => s.serveTerminationNotice)
  const viewingAs = useApp((s) => s.viewingAs)
  const allPartners = useApp((s) => s.partners)
  const candidates = useApp((s) => s.candidates)
  const dataScopeByRole = useApp((s) => s.dataScopeByRole)
  const dataEntitiesByRole = useApp((s) => s.dataEntitiesByRole)
  // Data-level RBAC: a scoped persona (set by the Super Admin in Admin > Data access) only sees
  // partners in their own region/state — and only if the Super Admin has "Partners directory"
  // checked as one of the screens that scope applies to for this persona.
  const myScope = viewingAs ? dataScopeByRole[viewingAs] : 'all'
  const myRegion = viewingAs ? DEMO_USERS[viewingAs]?.region : undefined
  const myState = viewingAs ? DEMO_USERS[viewingAs]?.state : undefined
  const scopesPartners = viewingAs ? (dataEntitiesByRole[viewingAs] ?? []).includes('partners') : false
  const isRegionScoped = myScope !== 'all' && scopesPartners
  const partners = useMemo(
    () => (isRegionScoped ? allPartners.filter((p) => inDataScope(p.state, myScope, myRegion, myState)) : allPartners),
    [allPartners, isRegionScoped, myScope, myRegion, myState],
  )
  // deep-link support — other screens (e.g. GTM Coverage, Analytics) can navigate here with a
  // partner name/state filter in location.state to land directly on the matching row(s); when
  // the name resolves to exactly one partner, open that partner's profile directly instead of
  // leaving the user to find and click it themselves.
  useEffect(() => {
    const state = location.state as { query?: string; stateFilter?: string; openId?: string } | null
    if (state?.openId) setOpenId(state.openId)
    else if (state?.query) {
      setQuery(state.query)
      setStatusFilter('all')
      const match = partners.filter((p) => p.legalName.toLowerCase() === state.query!.toLowerCase())
      if (match.length === 1) setOpenId(match[0].id)
    }
    if (state?.stateFilter) setStateFilter(state.stateFilter)
  }, [location.state, partners])
  // Hand-authored PROFILES plus a generated one for any partner promoted from the candidate
  // pipeline (id `candidate:<candidateId>`) that has no hand-authored entry.
  const profiles = useMemo(() => {
    const generated: Record<string, Profile> = {}
    for (const p of partners) {
      if (PROFILES[p.id]) continue
      const candidateId = p.id.startsWith('candidate:') ? p.id.slice('candidate:'.length) : null
      const c = candidateId ? candidates.find((cd) => cd.id === candidateId) : undefined
      if (c) generated[p.id] = buildCandidateProfile(c)
    }
    return { ...PROFILES, ...generated }
  }, [partners, candidates])
  const states = Array.from(new Set(partners.map((p) => p.state)))
  const q = query.trim().toLowerCase()
  const rows = partners.filter((p) =>
    (filter === 'all' || p.partnerType === filter)
    && (statusFilter === 'all' || p.status === statusFilter)
    && (stateFilter === 'all' || p.state === stateFilter)
    && (q === '' || p.legalName.toLowerCase().includes(q) || p.town.toLowerCase().includes(q) || p.state.toLowerCase().includes(q)),
  )
  const activeFilterCount = (statusFilter !== 'all' ? 1 : 0) + (stateFilter !== 'all' ? 1 : 0)
  const open = partners.find((p) => p.id === openId) ?? null

  if (open) {
    const prof = profiles[open.id] ?? DEFAULT_PROFILE
    const partnerGrievances = grievancesFor(open.legalName, grievances)
    const statusText = open.status === 'active' ? 'Active' : open.status === 'discontinued' ? 'Discontinued' : 'In review'
    const KPI_ICONS = ['analytics', 'leads', 'partners', 'flag'] as const
    const KPI_TONE = open.status === 'discontinued' ? 'crit' : open.status === 'active' ? 'good' : 'warn'
    const data: Profile360Data = {
      ...prof,
      kpis: prof.kpis.slice(0, 4).map((k, i) => ({
        ...k,
        icon: KPI_ICONS[i],
        tone: i === 3 ? KPI_TONE : 'ai',
        breakdown: kpiBreakdown(k, open, prof.trend),
      })),
      details: prof.details ?? [
        {
          title: 'Business background',
          rows: [
            { label: 'Legal name', value: open.legalName },
            { label: 'Partner type', value: partnerTypeLabel(open.partnerType) },
            { label: 'Town / City', value: open.town },
            { label: 'State', value: open.state },
            { label: 'Status', value: statusText },
            ...(open.dbCode ? [{ label: 'DB Code', value: open.dbCode }] : []),
            { label: 'Partner ID', value: partnerId(open) },
          ],
        },
        {
          title: 'Contact & registration',
          rows: contactDetails(open),
        },
      ],
      contactVerified: open.status !== 'in_review',
      timeline: toTimeline(prof.history),
      grievances: partnerGrievances.map((g) => ({ id: g.id, subject: g.subject, status: g.status, priority: g.priority, raisedOn: g.raisedOn })),
      name: open.legalName,
      color: PARTNER_TYPE_COLOR[open.partnerType],
      statusBadge: statusPill(open.status),
      metaChips: [
        { icon: 'partners', text: partnerTypeLabel(open.partnerType) },
        { icon: 'target', text: `${open.town}, ${open.state}` },
        { icon: 'documents', text: `Partner ID: ${partnerId(open)}` },
      ],
    }
    const missingDocs = prof.docs.filter((d) => d.status === 'not_checked').map((d) => d.name)
    const nudge = () => {
      const reason = missingDocs.length
        ? `Following up on ${open.legalName} — still waiting on: ${missingDocs.join(', ')}. Can you send these across?`
        : `Checking in on ${open.legalName} — let us know if there's anything blocking the next step.`
      nudgePartner({ code: CASE_CODE_BY_PARTNER[open.id] ?? open.id, town: open.town, partnerName: open.legalName, reason })
      navigate('/communication')
    }
    return (
      <div>
        <div className="page-head">
          <div className="row-between">
            <button className="btn text sm" style={{ padding: 0 }} onClick={() => setOpenId(null)}>← Back to directory</button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {open.status === 'active' && open.partnerType === 'distributor' && (
                <Button variant="ghost" size="sm" onClick={() => {
                  serveTerminationNotice({ partnerName: open.legalName, area: open.town, state: open.state, reason: '30-day termination notice' })
                  navigate('/intake-inbox', { state: { scouting: true } })
                }}><Icon name="flag" size={13} /> Serve termination notice</Button>
              )}
              <Button variant="ghost" size="sm" onClick={nudge}><Icon name="send" size={13} /> Nudge {open.legalName}</Button>
            </div>
          </div>
        </div>
        <Profile360 data={data} onAskCopilot={() => setCopilotOpen(true)} />
      </div>
    )
  }

  const total = partners.length
  const activeN = partners.filter((p) => p.status === 'active').length
  const reviewN = partners.filter((p) => p.status === 'in_review').length
  const discN = partners.filter((p) => p.status === 'discontinued').length
  // Realized revenue only — projected figures for in-review/pending partners (shown in their
  // own row) don't count toward the live "Total Monthly Sales" headline.
  const totalSales = partners.filter((p) => p.status === 'active').reduce((s, p) => s + salesLakh(p.id, profiles), 0)
  const growths = partners.map((p) => growthOf(p.id, profiles).pct).filter((x): x is number => x != null)
  const avgGrowth = growths.length ? growths.reduce((a, b) => a + b, 0) / growths.length : 0
  const pct = (n: number) => `${Math.round((n / total) * 100)}% of total`

  const STATS: { key: StatKey; label: string; value: string; sub: string; icon: Parameters<typeof Icon>[0]['name']; tone: string }[] = [
    { key: 'total', label: 'Total Partners', value: String(total), sub: 'All types', icon: 'partners', tone: 'ai' },
    { key: 'active', label: 'Active Partners', value: String(activeN), sub: pct(activeN), icon: 'approvals', tone: 'good' },
    { key: 'review', label: 'In Review', value: String(reviewN), sub: pct(reviewN), icon: 'documents', tone: 'warn' },
    { key: 'disc', label: 'Discontinued', value: String(discN), sub: pct(discN), icon: 'flag', tone: 'crit' },
    { key: 'sales', label: 'Total Monthly Sales', value: fmtCr(totalSales), sub: 'Active partners only', icon: 'analytics', tone: 'ai' },
    { key: 'growth', label: 'Avg. Growth', value: `${avgGrowth >= 0 ? '↑' : '↓'} ${Math.abs(avgGrowth).toFixed(1)}%`, sub: 'vs last month', icon: 'leads', tone: 'good' },
  ]

  // What a stat tile actually rolls up — the ranked/filtered partner list behind its number.
  const breakdownRows = (key: StatKey | null): { p: Partner; metric: string; pct?: number }[] => {
    if (!key) return []
    if (key === 'total') return partners.map((p) => ({ p, metric: partnerTypeLabel(p.partnerType) }))
    if (key === 'active') return partners.filter((p) => p.status === 'active').map((p) => ({ p, metric: 'Active' }))
    if (key === 'review') return partners.filter((p) => p.status === 'in_review').map((p) => ({ p, metric: 'In review' }))
    if (key === 'disc') return partners.filter((p) => p.status === 'discontinued').map((p) => ({ p, metric: 'Discontinued' }))
    if (key === 'sales') {
      return partners.filter((p) => p.status === 'active' && salesLakh(p.id, profiles) > 0)
        .map((p) => ({ p, metric: fmtCr(salesLakh(p.id, profiles)), pct: totalSales ? Math.round((salesLakh(p.id, profiles) / totalSales) * 100) : 0 }))
        .sort((a, b) => salesLakh(b.p.id, profiles) - salesLakh(a.p.id, profiles))
    }
    return partners.filter((p) => growthOf(p.id, profiles).pct != null)
      .map((p) => ({ p, metric: growthOf(p.id, profiles).raw, pct: growthOf(p.id, profiles).pct! }))
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
  }
  const BREAKDOWN_TITLE: Record<StatKey, string> = {
    total: 'All partners', active: 'Active partners', review: 'Partners in review',
    disc: 'Discontinued partners', sales: 'What makes up Total Monthly Sales', growth: 'Growth by partner',
  }

  return (
    <div>
      <div className="page-head">
        <div className="row-between">
          <div>
            <h1>Partners <span className="page-info-ic" title="Monitor and manage all your partners in one place. Get a real-time view of their performance and status."><Icon name="help" size={13} /></span></h1>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {viewingAs !== 'ase_asm' && (
              <Button onClick={() => navigate('/new-application')}><Icon name="new" size={14} /> Add Partner</Button>
            )}
          </div>
        </div>
      </div>

      <div className="pt-summary">
        {STATS.map((s) => (
          <button type="button" className="pt-stat pt-stat-btn" key={s.key} onClick={() => setBreakdown(s.key)}>
            <span className={`pt-stat-ic pt-tone-${s.tone}`}><Icon name={s.icon} size={17} /></span>
            <div className="pt-stat-label">{s.label}</div>
            <div className="pt-stat-value">{s.value}</div>
            <div className="pt-stat-sub">{s.sub}</div>
            <span className="pt-stat-hint">What made this? →</span>
          </button>
        ))}
      </div>

      <div className="pt-toolbar">
        <div className="tabs">
          <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All Types</button>
          {PARTNER_TYPES.map((t) => (
            <button key={t.code} className={`tab ${filter === t.code ? 'active' : ''}`} onClick={() => setFilter(t.code)}>{t.label.split(' ')[0]}</button>
          ))}
        </div>
        <div className="pt-toolbar-actions">
          <span className="pt-search"><Icon name="search" size={14} />
            <input placeholder="Search partner, location…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <div className="pt-filter-wrap">
            <Button variant="ghost" size="sm" onClick={() => setFiltersOpen((v) => !v)}>
              <Icon name="list" size={13} /> Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
            </Button>
            {filtersOpen && (
              <div className="pt-filter-pop">
                <div className="pt-filter-group">
                  <div className="pt-filter-label">Status</div>
                  <div className="pt-filter-opts">
                    {(['all', 'active', 'in_review', 'discontinued'] as const).map((s) => (
                      <button key={s} className={`pt-filter-chip ${statusFilter === s ? 'on' : ''}`} onClick={() => setStatusFilter(s)}>
                        {s === 'all' ? 'All' : s === 'in_review' ? 'In review' : s[0].toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pt-filter-group">
                  <div className="pt-filter-label">State</div>
                  <div className="pt-filter-opts">
                    <button className={`pt-filter-chip ${stateFilter === 'all' ? 'on' : ''}`} onClick={() => setStateFilter('all')}>All</button>
                    {states.map((s) => (
                      <button key={s} className={`pt-filter-chip ${stateFilter === s ? 'on' : ''}`} onClick={() => setStateFilter(s)}>{s}</button>
                    ))}
                  </div>
                </div>
                <div className="pt-filter-foot">
                  <button className="btn text sm" onClick={() => { setStatusFilter('all'); setStateFilter('all') }}>Clear</button>
                  <button className="btn sm" onClick={() => setFiltersOpen(false)}>Done</button>
                </div>
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm"><Icon name="documents" size={13} /> Download</Button>
        </div>
      </div>

      <div className="dtable-wrap">
        <table className="dtable">
          <thead><tr><th>Partner</th><th>Type</th><th>Location</th><th>Status</th><th>Monthly Sales</th><th>Growth</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: '1.4rem 0' }}>No partners match these filters.</td></tr>
            )}
            {rows.map((p) => {
              const g = growthOf(p.id, profiles)
              const gClass = g.raw.includes('▼') || p.status === 'discontinued' ? 'pt-growth-down' : g.pct != null ? 'pt-growth-up' : 'pt-growth-flat'
              return (
                <tr key={p.id} className={`clickable ${p.status === 'discontinued' ? 'pt-crit' : ''}`} onClick={() => setOpenId(p.id)}>
                  <td>
                    <div className="pt-name-cell">
                      <span className="pt-avatar" style={{ background: PARTNER_TYPE_COLOR[p.partnerType] }}>{initialsOf(p.legalName)}</span>
                      <div>
                        <div className="pt-name">{p.legalName}</div>
                        <div className="pt-id">{p.dbCode ?? partnerId(p)}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="type-badge"><span className="d" style={{ background: PARTNER_TYPE_COLOR[p.partnerType] }} />{partnerTypeLabel(p.partnerType).split(' ')[0]}</span></td>
                  <td><span className="pt-loc"><Icon name="target" size={13} />{p.town}, {p.state}</span></td>
                  <td>{statusPill(p.status)}</td>
                  <td className="num tnum">{profiles[p.id]?.kpis[0]?.value ?? '—'}</td>
                  <td className={`num ${gClass}`}>{g.raw}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="pt-row-actions">
                      <Button variant="ghost" size="sm" onClick={() => setOpenId(p.id)}>View</Button>
                      <div className="pt-menu-wrap">
                        <button className="pt-menu-btn" title="More" aria-label="More actions"
                          onClick={() => setRowMenu(rowMenu === p.id ? null : p.id)}>···</button>
                        {rowMenu === p.id && (
                          <>
                            <div className="pt-menu-backdrop" onClick={() => setRowMenu(null)} />
                            <div className="pt-menu" role="menu">
                              <button role="menuitem" onClick={() => { setOpenId(p.id); setRowMenu(null) }}>
                                <Icon name="external" size={13} /> View profile
                              </button>
                              <button role="menuitem" className="danger" onClick={() => { removePartner(p.id); setRowMenu(null) }}>
                                <Icon name="close" size={13} /> Remove
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="pt-foot">
        <span className="pt-foot-count">Showing 1 to {rows.length} of {total} partners</span>
        <div className="pt-pager">
          <button disabled aria-label="Previous">‹</button>
          <button className="on">1</button>
          <button disabled aria-label="Next">›</button>
        </div>
      </div>

      <Modal open={!!breakdown} onClose={() => setBreakdown(null)} title={breakdown ? BREAKDOWN_TITLE[breakdown] : ''}>
        <div className="pt-breakdown">
          {breakdownRows(breakdown).length === 0 ? (
            <p className="muted-note">No partners contribute to this figure yet.</p>
          ) : breakdownRows(breakdown).map(({ p, metric, pct: share }) => (
            <button key={p.id} className="pt-breakdown-row" onClick={() => { setOpenId(p.id); setBreakdown(null) }}>
              <span className="pt-avatar sm" style={{ background: PARTNER_TYPE_COLOR[p.partnerType] }}>{initialsOf(p.legalName)}</span>
              <span className="pt-breakdown-main">
                <span className="n">{p.legalName}</span>
                <span className="t">{p.town}, {p.state}</span>
              </span>
              <span className="pt-breakdown-metric">
                <span className="v">{metric}</span>
                {share != null && (
                  <span className="bar"><i style={{ width: `${Math.min(100, Math.abs(share))}%` }} /></span>
                )}
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}

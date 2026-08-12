import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { Profile360 } from '../components/Profile360'
import type { Profile360Data } from '../components/Profile360'
import { useApp, useMe } from '../store'
import { grievancesFor } from '../mock/grievances'
import type { Grievance } from '../mock/grievances'
import type { MatchedDistributor } from '../mock/leads'
import type { CandidateCard } from '../types'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const num = (s: string) => parseInt(s.replace(/[^\d]/g, ''), 10) || 0

function toCandidateCard(d: MatchedDistributor & { town: string }): CandidateCard {
  return {
    id: `dist-${slug(d.agency)}`, name: d.agency, town: d.town, dbCategory: d.dbCategory,
    turnoverMonthly: num(d.monthlyTurnover), expectedRcplTurnover: num(d.rcplTurnover), coverageOutlets: num(d.coverage),
    infraScore: d.headroom === 'high' ? 8 : d.headroom === 'some' ? 6.5 : 5, finEvalPct: num(d.wsContribution) + 50,
    stage: d.status === 'Active' ? 'active' : 'open', confidencePct: d.status === 'Active' ? 88 : 60,
  }
}

const catColor: Record<string, string> = {
  'GT DB (with CSO/DSM)': 'var(--p-ase)', 'GM Excl DB': 'var(--p-mdm)', Traders: 'var(--p-channel)',
}

// Deterministic sales trend seeded by name (no randomness).
function trendFor(name: string): number[] {
  const seed = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const pts: number[] = []; let v = 40
  for (let i = 0; i < 7; i++) { v += ((seed * 5 + i * 13) % 15) - 6; pts.push(Math.max(12, Math.min(90, v))) }
  return pts
}

const headroomText = (h: string) => (h === 'high' ? 'High headroom' : h === 'some' ? 'Some headroom' : 'At capacity')

function toProfile(d: MatchedDistributor & { town?: string }, grievances: Grievance[]): Profile360Data {
  const active = d.status === 'Active'
  const town = d.town ?? 'Maharashtra'
  const email = `${slug(d.agency)}@gmail.com`
  return {
    grievances: grievances.map((g) => ({ id: g.id, subject: g.subject, status: g.status, priority: g.priority, raisedOn: g.raisedOn })),
    name: d.agency,
    color: catColor[d.dbCategory] ?? 'var(--ai)',
    statusBadge: active ? <Pill tone="good" dot>Active</Pill> : <Pill tone="warn" dot>In review</Pill>,
    metaChips: [
      { icon: 'partners', text: d.dbCategory },
      { icon: 'target', text: `${town}, Maharashtra` },
      { icon: 'leads', text: headroomText(d.headroom) },
    ],
    contactVerified: active,
    timeline: (active
      ? ['Appointed & auto-cleared', 'Renewal current']
      : ['Application in review', 'Lead Generation Agent · matched to a coverage gap']
    ).reverse().map((t) => ({ title: t, tone: active ? 'good' as const : 'warn' as const })),
    kpis: [
      { label: 'Monthly turnover', value: d.monthlyTurnover, icon: 'analytics', tone: 'ai' },
      { label: 'RCPL / month', value: d.rcplTurnover, icon: 'leads', tone: 'ai' },
      { label: 'Coverage', value: d.coverage, icon: 'partners', tone: 'ai' },
      { label: 'WS contribution', value: d.wsContribution, icon: 'flag', tone: active ? 'good' : 'warn' },
    ],
    details: [
      {
        title: 'Business background',
        rows: [
          { label: 'Agency / Firm name', value: d.agency },
          { label: 'DB category', value: d.dbCategory },
          { label: 'Town', value: town },
          { label: 'State', value: 'Maharashtra' },
          { label: 'Status', value: active ? 'Active' : 'In review' },
          { label: 'Capacity headroom', value: headroomText(d.headroom) },
        ],
      },
      {
        title: 'Coverage & turnover',
        rows: [
          { label: 'Total monthly turnover', value: d.monthlyTurnover },
          { label: 'Expected RCPL turnover / mo', value: d.rcplTurnover },
          { label: 'Overall coverage', value: d.coverage },
          { label: 'WS contribution', value: d.wsContribution },
        ],
      },
      {
        title: 'Contact & registration',
        rows: [
          { label: 'Email', value: email },
          { label: 'GST', value: active ? 'Verified' : 'Awaiting submission' },
          { label: 'FSSAI', value: active ? 'Verified' : 'Awaiting submission' },
        ],
      },
    ],
    overview: `${d.agency} is ${active ? 'an active' : 'an in-review'} ${d.dbCategory} distributor. ${d.note}`,
    trend: trendFor(d.agency),
    docs: active
      ? [{ name: 'GST Certificate', status: 'verified' }, { name: 'FSSAI License', status: 'verified' }]
      : [{ name: 'GST Certificate', status: 'not_checked' }, { name: 'DB Onboarding Form', status: 'not_checked' }],
    history: active
      ? ['Appointed & auto-cleared', 'Renewal current']
      : ['Application in review'],
    agentLog: [
      'Lead Generation Agent · matched to a coverage/turnover gap',
      active ? 'Evaluation Agent · previously auto-cleared' : 'Evaluation Agent · scored 2 forks',
      'Document Intelligence · ' + (active ? 'GST + FSSAI verified' : 'pending'),
    ],
  }
}

export function DistributorProfile() {
  const loc = useLocation()
  const navigate = useNavigate()
  const setCopilotOpen = useApp((s) => s.setCopilotOpen)
  const shortlistCandidate = useApp((s) => s.shortlistCandidate)
  const pushNotification = useApp((s) => s.pushNotification)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const me = useMe()
  const grievances = useApp((s) => s.grievances)
  const d = loc.state as (MatchedDistributor & { town: string }) | null

  if (!d) {
    return (
      <div>
        <div className="page-head">
          <h1>Distributor profile <span className="page-info-ic" title="Open a distributor from a lead's matched list to see its profile."><Icon name="help" size={13} /></span></h1>
        </div>
        <Button onClick={() => navigate('/leads')}>Go to Leads →</Button>
      </div>
    )
  }

  // Shortlist the distributor for comparison. ASE/ASM doesn't run the New Application wizard —
  // they land back on Leads where the created lead shows; Channel Development goes to the wizard.
  const onEvaluate = () => {
    shortlistCandidate({ ...toCandidateCard(d), userCreated: true, createdBy: viewingAs, createdById: me?.id, createdAt: Date.now() })
    if (viewingAs === 'ase_asm') {
      // Hand-off signal for Trade Marketing (Channel Development)
      pushNotification({
        title: 'Lead shortlisted — please check',
        body: `${d.agency} (${d.town}) has been shortlisted from the distributor directory. Review and compare it in New Application.`,
        href: '/new-application',
        forRole: 'channel_dev',
      })
    }
    navigate(viewingAs === 'ase_asm' ? '/leads' : '/new-application')
  }

  return (
    <div>
      <div className="page-head">
        <div className="row-between">
          <div>
            <h1>{d.agency} <span className="page-info-ic" title="Active distributor surfaced by the Lead Generation Agent — full 360° view, same as the Partners directory. Evaluate adds it to the New Application candidate pipeline so you can score it and move it through stages."><Icon name="help" size={13} /></span></h1>
          </div>
          <Button onClick={onEvaluate}>Evaluate →</Button>
        </div>
      </div>
      <Profile360 data={toProfile(d, grievancesFor(d.agency, grievances))} onAskCopilot={() => setCopilotOpen(true)} />
    </div>
  )
}

import './Approvals.css'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, Modal, Pill } from '../components/ui'
import { AgentTrace } from '../components/ui/AgentTrace'
import type { TraceLine } from '../components/ui/AgentTrace'
import { Icon } from '../components/ui/icons'
import { PARTNER_TYPE_COLOR, partnerTypeLabel } from '../mock/templates'
import { useApp, useMe } from '../store'
import { ROLE_BY_CODE, DEMO_USERS } from '../mock/roles'
import { memberName } from '../mock/team'
import { CaseTimeline } from '../components/CaseTimeline'
import { OnboardingPanel, OnboardingDetail } from './OnboardingCases'
import { eligibleMembers, isUserAvailable } from '../lib/assignment'
import { CASE_TYPE_LABEL, START_STATE, STATE_DESC, STATE_ORDER, TERMINAL_STATES, stamp, stateLabel } from '../lib/caseEngine'
import { liveSlaState, liveSlaLabel, SLA_TONE } from '../lib/workingDays'
import { EXTRACTIONS, mergedFields } from '../mock/intake'
import type { RequiredDoc } from '../mock/intake'
import { BACKGROUND_INFORMATION } from '../mock/recommendationForm'
import { buildPdf, openPdfInNewTab } from '../lib/pdf'
import { REQUIRED_INVESTMENT, INFRA_THRESHOLD, EXPECTED_RCPL_TURNOVER, round1 } from '../mock/onboarding'
import { authorityFor, SLA_CONFIG } from '../mock/authorityMatrix'
import { computeRoi, roiOk, contributionOk, contributionPctFor, ROI_TARGET_MIN, CONTRIBUTION_MIN } from '../lib/roi'
import { getCaseAuditTrail } from '../lib/caseHistory'
import { DisengagementFormModal } from '../components/DisengagementForm'
import type { CandidateCard, CaseFinanceSnapshot, CaseChannelSnapshot, CaseRecord, PartnerTypeCode, RoleCode } from '../types'

const TEAM_LABEL: Record<RoleCode, string> = {
  finance: 'Finance', channel_dev: 'Trade Marketing', mdm: 'MDM', it: 'IT', leadership: 'Leadership', ase_asm: 'ASE', asm: 'ASM', rbl: 'RBL', admin: 'Admin',
}
const SUBTYPE_DB_LABEL: Record<string, string> = { new: 'New DB', replacement: 'Replacement DB', additional: 'Additional DB' }

// Finance checks exactly two numbers from the recommendation form — Total Own Funds/Borrowed and
// CC Limit — backed by one real document (the distributor's bank statement), not a stack of
// generic paperwork unrelated to what's actually being evaluated.
const BANK_STATEMENT_KEY = 'bank_statement'

// Banded, not precise — a flagged case always carries some risk, so this reads off the real
// gap-to-threshold ratio when one exists, and a fixed "Medium" default otherwise (no snapshot
// numbers to back a more specific claim).
function riskLevel(gapRatio: number): { label: string; tone: 'good' | 'warn' | 'crit' } {
  if (gapRatio <= 0) return { label: 'Low', tone: 'good' }
  if (gapRatio < 0.15) return { label: 'Medium', tone: 'warn' }
  return { label: 'High', tone: 'crit' }
}
function gapRatioFor(c: CaseRecord): number {
  if (c.financeSnapshot) return c.financeSnapshot.fundingGap / c.financeSnapshot.requiredInvestment
  if (c.channelSnapshot) return c.channelSnapshot.gap / c.channelSnapshot.threshold
  return 0.1
}

// Older/seeded cases can carry a flag as free text only (no structured snapshot) — but the
// percentage or score in that text is real, so derive a numeric snapshot from it rather than
// hiding the numbers entirely. Returns undefined (never a made-up number) if nothing parses.
// Falls back to the flat REQUIRED_INVESTMENT reference figure (not requiredInvestmentFor) because
// these seeded cases never carried the underlying turnover/expected-RCPL-turnover numbers a real
// per-DB figure would need — there's nothing to compute from, only a pre-baked percentage.
function deriveFinanceSnapshot(c: CaseRecord): CaseFinanceSnapshot | undefined {
  if (c.financeSnapshot) return c.financeSnapshot
  if (c.ownerRole !== 'finance') return undefined
  const pct = parseFloat((c.flagDetail ?? '').match(/(\d+(?:\.\d+)?)%/)?.[1] ?? '')
  if (!Number.isFinite(pct)) return undefined
  const capitalAvailable = Math.round((pct / 100) * REQUIRED_INVESTMENT)
  // Seeded/legacy cases only ever carried the combined figure — split it own-funds-led (65/35),
  // same approximation the batch-evaluate flow uses, so older cases still show both numbers.
  const ownFunds = Math.round(capitalAvailable * 0.65)
  return { ownFunds, ccLimit: capitalAvailable - ownFunds, capitalAvailable, requiredInvestment: REQUIRED_INVESTMENT, fundingGap: round1(Math.max(0, REQUIRED_INVESTMENT - capitalAvailable)), readinessPct: Math.round(pct) }
}
function deriveChannelSnapshot(c: CaseRecord): CaseChannelSnapshot | undefined {
  if (c.channelSnapshot) return c.channelSnapshot
  if (c.ownerRole !== 'channel_dev') return undefined
  const score = parseFloat((c.flagDetail ?? '').match(/(\d+(?:\.\d+)?)\s*\/\s*10/)?.[1] ?? '')
  if (!Number.isFinite(score)) return undefined
  return { score, threshold: INFRA_THRESHOLD, gap: Math.max(0, INFRA_THRESHOLD - score), readinessPct: Math.round((score / INFRA_THRESHOLD) * 100) }
}

// The single source of truth for "can this case be approved yet" — checked before both the
// single-case Approve button AND bulk-approve, so selecting a case in the list and bulk-approving
// it can't skip the document gate that the case-review screen enforces. Gate state lives on the
// case record itself (financeDocsUploaded / channelDocUploaded / hasDiscontinuationForm), not in
// component state, so it's visible here in the list view too.
function caseDocGateBlocked(c: CaseRecord): boolean {
  // Neither team's supporting document (Finance's bank statement, Channel Development's
  // coverage plan) is a hard gate anymore — a reviewer can approve without it, after confirming
  // they're ready to continue and optionally leaving a note explaining why. Only the
  // Discontinuation Form for a replacement DB still hard-blocks (a distinct compliance
  // requirement, not the document-upload restriction this was relaxed for).
  if (c.subtype === 'replacement' && !c.hasDiscontinuationForm) return true
  return false
}

// Half-donut confidence gauge — SVG arcs sized by pathLength so no trig is needed for the stroke math.
function ArcGauge({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
  const tone = clamped >= 70 ? 'var(--good)' : clamped >= 50 ? 'var(--warn)' : 'var(--crit)'
  const d = 'M 10 62 A 50 50 0 0 1 110 62'
  return (
    <div className="arc-gauge">
      <svg viewBox="0 0 120 70" width="140" height="82">
        <path d={d} fill="none" stroke="var(--surface-3)" strokeWidth={10} strokeLinecap="round" pathLength={100} />
        <path d={d} fill="none" stroke={tone} strokeWidth={10} strokeLinecap="round" pathLength={100} strokeDasharray={`${clamped} 100`} />
      </svg>
      <div className="arc-gauge-value">{clamped}%</div>
    </div>
  )
}

// AI Insights — built only from real, derivable data; nothing here is a fixed/fabricated count.
function aiInsights(c: CaseRecord, flagSummary: string): { label: string; tone: 'good' | 'warn' | 'crit' }[] {
  const out: { label: string; tone: 'good' | 'warn' | 'crit' }[] = []
  if (c.financeSnapshot) {
    const capitalAvailable = Math.round(c.financeSnapshot.capitalAvailable)
    const requiredInvestment = Math.round(c.financeSnapshot.requiredInvestment)
    out.push(capitalAvailable >= requiredInvestment
      ? { label: `Capital available (₹${capitalAvailable}L) meets the required investment (₹${requiredInvestment}L).`, tone: 'good' }
      : { label: `Capital available (₹${capitalAvailable}L) is below the required investment (₹${requiredInvestment}L).`, tone: 'crit' })
  } else if (c.channelSnapshot) {
    const { score, threshold } = c.channelSnapshot
    out.push(score >= threshold
      ? { label: `Infrastructure & coverage (${score.toFixed(1)}/10) meets the RCPL benchmark.`, tone: 'good' }
      : { label: `Infrastructure & coverage (${score.toFixed(1)}/10) is below the ${threshold}/10 benchmark.`, tone: 'crit' })
  } else {
    // Seeded demo cases carry no structured snapshot — fall back to the same flag text shown
    // in the hero, so "what's missing" is never silently absent from AI Insights.
    out.push({ label: flagSummary, tone: 'crit' })
  }
  // Shared "Background Information" workbook defaults this app already reuses for every lead
  // (see mock/recommendationForm.ts) — real demo data, not invented for this screen.
  const agencySince = BACKGROUND_INFORMATION.find((f) => f.key === 'agency_since')?.value
  const companiesHandled = BACKGROUND_INFORMATION.find((f) => f.key === 'companies_handled')?.value
  if (agencySince && companiesHandled) {
    out.push({ label: `Strong business history of ${agencySince} years with reputed brands (${companiesHandled}).`, tone: 'good' })
  }
  if (c.channelSnapshot && c.channelSnapshot.readinessPct >= 70 && c.channelSnapshot.readinessPct < 100) {
    out.push({ label: 'Geographic coverage is moderate and can be improved.', tone: 'warn' })
  }
  return out
}

type JourneyState = 'done' | 'current' | 'pending'
// dbCodeDone: has IT actually finished creating the DB Code yet (linked Partner has one)? undefined
// when the case hasn't activated at all, so this step doesn't render prematurely.
function journeySteps(c: CaseRecord, teamLabel: string, dbCodeDone?: boolean): { label: string; state: JourneyState; desc: string }[] {
  const clean = !!c.autoCleared
  const approved = c.status === 'approved'
  const teamState: JourneyState = c.status === 'flagged' ? 'current' : 'done'
  const activatedState: JourneyState = approved ? 'done' : 'pending'
  const base: { label: string; state: JourneyState; desc: string }[] = [
    { label: 'Recommendation Submitted', state: 'done', desc: 'The ASM submitted the recommendation form for this candidate.' },
    { label: 'AI Evaluation', state: 'done', desc: 'The engine scored the Financial and Channel-Management evaluations independently.' },
  ]
  // Once activated, IT still has to actually create the DB Code — that's a separate step on a
  // separate record (OnboardingCase), not automatic just because this case shows "Activated".
  const dbCodeStep: { label: string; state: JourneyState; desc: string }[] = activatedState === 'done'
    ? [{ label: 'DB Code Created (IT)', state: dbCodeDone ? 'done' : 'current',
        desc: dbCodeDone ? 'IT created the DB Code — onboarding is complete.' : 'With IT now — they create the DB Code before this distributor is fully onboarded.' }]
    : []
  // A clean (auto-cleared) case still needs Channel Development's real approval — it just skips
  // Leadership on top of that once Channel Dev clears it, activating straight to IT instead.
  if (clean) {
    return [
      ...base,
      { label: `${teamLabel} Approval (clean case)`, state: teamState, desc: `Both evaluations passed with no issues — ${teamLabel} still signs off before it goes to IT.` },
      { label: 'Activated — sent to IT', state: activatedState, desc: `${teamLabel}'s approval activates the distributor and sends it straight to IT for the DB Code — no Leadership sign-off needed.` },
      ...dbCodeStep,
    ]
  }
  const leadershipState: JourneyState = approved ? 'done' : c.ownerRole === 'leadership' ? 'current' : 'pending'
  return [
    ...base,
    { label: `${teamLabel} Review`, state: teamState, desc: `${teamLabel} reviews the flagged dimension and clears it or returns it to the sales team.` },
    { label: 'Leadership Sign-off', state: leadershipState, desc: 'Once the flagged dimension clears, Leadership gives the final sign-off.' },
    { label: 'Activated — sent to IT', state: activatedState, desc: 'Leadership\'s sign-off activates the distributor and sends it to IT for the DB Code.' },
    ...dbCodeStep,
  ]
}
const JOURNEY_CAPTION: Record<JourneyState, string> = { done: 'Completed', current: 'In Progress', pending: 'Pending' }

// Real email address when the flagged candidate came in over email intake; a plausible
// placeholder otherwise (seeded cases and directory leads carry no email on the record itself).
function emailForCase(c: CaseRecord, candidates: CandidateCard[]): string {
  const cand = candidates.find((x) => x.id === c.candidateId)
  const ext = cand?.sourceIntakeId ? EXTRACTIONS[cand.sourceIntakeId] : undefined
  if (ext?.channel === 'email') return ext.source
  const emailField = ext ? mergedFields(ext).find((f) => /email/i.test(f.label) && f.ok)?.value : undefined
  if (emailField) return emailField
  return `${c.partnerName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/(^\.|\.$)/g, '')}@example.com`
}

// Roles that own an approval queue — a case only shows up for these personas once it's
// actually theirs to act on (see mock/cases.ts ownerRole); reused by Dashboard's Recent Cases
// so MDM/Finance/Channel Development don't see each other's still-open flagged cases.
// IT is included here for the same reason MDM/Finance/etc. are: it never owns a flagged
// CaseRecord (its work lives on OnboardingCase instead — see Dashboard's dbCodeQueue), so without
// this it would fall into the "everyone else" bucket and see the whole org's case queue instead
// of nothing, which is the correct state for a persona whose queue lives elsewhere.
export const OWNER_ROLES: RoleCode[] = ['finance', 'channel_dev', 'mdm', 'it', 'leadership']

// confidencePct = likelihood to auto-clear — low is expected for a case that's sitting in Approvals at all.
const confidenceTone = (pct: number): 'good' | 'warn' | 'crit' => (pct >= 70 ? 'good' : pct >= 50 ? 'warn' : 'crit')

// "All cases" also surfaces already-resolved cases (see rows' filter comment above) — this is
// the only place their outcome shows, since every other column (SLA, Owner) only makes sense
// for a still-open case.
const STATUS_LABEL: Record<CaseRecord['status'], string> = {
  draft: 'Draft', auto_cleared: 'Auto-cleared', flagged: 'In review', approved: 'Approved', rejected: 'Rejected',
  sent_back: 'Sent back to field team',
}
const STATUS_TONE: Record<CaseRecord['status'], 'good' | 'warn' | 'crit' | 'neutral'> = {
  draft: 'neutral', auto_cleared: 'good', flagged: 'warn', approved: 'good', rejected: 'crit',
  sent_back: 'warn',
}
const REVIEW_TEAM_LABEL: Record<string, string> = { finance: 'Finance', channel_dev: 'Trade Marketing' }

// A dual-fail candidate raises TWO cases (one to Finance, one to Trade Marketing). When only ONE
// of them approves, decideCase intentionally PARKS that case — status flips to 'approved' but
// ownerRole stays with that team — it does NOT route to Leadership until the sibling also clears.
// Left as a flat "Approved" (good/green), that reads as "fully done" when it's actually still
// waiting on the other team — which is exactly what made a parked case look like it had vanished
// once someone went looking for it under Leadership. This finds that still-open sibling, if any.
function siblingStillOpen(c: CaseRecord, allCases: CaseRecord[]): CaseRecord | undefined {
  if (!c.candidateId || c.status !== 'approved') return undefined
  if (c.ownerRole !== 'finance' && c.ownerRole !== 'channel_dev') return undefined
  return allCases.find((x) => x.candidateId === c.candidateId && x.code !== c.code && x.status === 'flagged'
    && (x.ownerRole === 'finance' || x.ownerRole === 'channel_dev'))
}

const FILTERS: { key: PartnerTypeCode | 'all'; label: string }[] = [
  { key: 'all', label: 'All types' },
  { key: 'distributor', label: 'Distributor' },
  { key: 'vendor', label: 'Vendor' },
]

// Human-readable flag reason per owning team (the Evaluation Agent's finding). Cases the New
// Application wizard raises carry their own computed flagDetail — use that when present instead
// of the generic seeded-case text, so the number shown here matches what actually failed.
function flagReason(c: CaseRecord): { summary: string; lines: TraceLine[] } {
  if (c.ownerRole === 'leadership') {
    const authority = c.signoffAuthority ?? 'SM'
    return {
      summary: c.flagDetail ?? `Financial & infra checks clear — routed to ${authority} for final sign-off.`,
      lines: [
        { text: '> Evaluation Agent — approval matrix', tone: 'accent' },
        { text: 'Checking financial criteria… meets threshold → CLEAR', tone: 'ok' },
        { text: 'Checking infrastructure & coverage… meets threshold → CLEAR', tone: 'ok' },
        { text: `Decision: route to ${authority} for final sign-off. Confidence: ${c.confidencePct}%.`, tone: 'accent' },
      ],
    }
  }
  if (c.ownerRole === 'channel_dev') {
    return {
      summary: c.flagDetail ?? 'Infrastructure & coverage score is below the territory threshold.',
      lines: [
        { text: '> Evaluation Agent — approval matrix', tone: 'accent' },
        { text: 'Checking financial criteria… CC limit meets threshold → CLEAR', tone: 'ok' },
        { text: `Checking infra & coverage… ${c.flagDetail ?? '6.4 vs required 7.0 → OUT OF RANGE'}`, tone: 'bad' },
        { text: `Decision: route to Channel Development. Confidence: ${c.confidencePct}%.`, tone: 'accent' },
      ],
    }
  }
  if (c.ownerRole === 'mdm') {
    return {
      summary: c.flagDetail ?? 'Document set incomplete — pending MDM verification.',
      lines: [
        { text: '> Evaluation Agent — approval matrix', tone: 'accent' },
        { text: 'Checking documents… 2 of 6 required documents missing → INCOMPLETE', tone: 'bad' },
        { text: `Decision: route to MDM document check. Confidence: ${c.confidencePct}%.`, tone: 'accent' },
      ],
    }
  }
  return {
    summary: c.flagDetail ?? 'CC limit ₹80L is below the required ₹100L threshold.',
    lines: [
      { text: '> Evaluation Agent — approval matrix', tone: 'accent' },
      { text: `Checking financial criteria… ${c.flagDetail ?? 'CC limit ₹80L vs required ₹100L → OUT OF RANGE'}`, tone: 'bad' },
      { text: 'Checking infrastructure & coverage… meets threshold → CLEAR', tone: 'ok' },
      { text: `Decision: route to Finance. Confidence: ${c.confidencePct}%.`, tone: 'accent' },
    ],
  }
}

export function Approvals() {
  const [filter, setFilter] = useState<PartnerTypeCode | 'all'>('all')
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [openCode, setOpenCode] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  // Additional queue filters.
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | CaseRecord['status']>('all')
  const [ownerFilter, setOwnerFilter] = useState<'all' | RoleCode>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | string>('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const [openOnboardingId, setOpenOnboardingId] = useState<string | null>(null)
  // Shared with New Application — a candidate flagged there raises a real case here, so it's
  // the same queue whether you got to it from the wizard or the sidebar.
  const cases = useApp((s) => s.flaggedCases)
  const decideCase = useApp((s) => s.decideCase)
  const logAudit = useApp((s) => s.logAudit)
  const pushNotification = useApp((s) => s.pushNotification)
  const requestInfoFromAsm = useApp((s) => s.requestInfoFromAsm)
  const sendCaseBackToAsm = useApp((s) => s.sendCaseBackToAsm)
  const markOnboardingNotified = useApp((s) => s.markOnboardingNotified)
  const onboardingCases = useApp((s) => s.onboardingCases)
  const isOwner = OWNER_ROLES.includes(viewingAs)
  const effectiveScope = isOwner ? scope : 'all'
  // Deep-link: opening Approvals with { state: { openCode } } (e.g. Dashboard's "View case")
  // lands directly on that case's review instead of the queue.
  const location = useLocation()
  useEffect(() => {
    const st = location.state as { openCode?: string; openOnboardingId?: string } | null
    if (st?.openCode) setOpenCode(st.openCode)
    if (st?.openOnboardingId) setOpenOnboardingId(st.openOnboardingId)
  }, [location.state])
  // Only the owning reviewer teams (and admin) can actually approve/reject. The field team
  // (ASE/ASM, L1) can open a case and respond, but the approval decision is NOT theirs to make —
  // a clean case routes to Leadership (L3); a flagged one goes to its L2 team (Finance / Channel
  // Development) and then up to Leadership (L3). Only L2/L3 (and admin) approve.
  const canApprove = isOwner || viewingAs === 'admin'

  // The REAL logged-in person (so two different people who share a role — e.g. two Channel
  // Development reviewers — genuinely show up as themselves on the case timeline/audit log, not
  // both attributed to the same fixed per-role demo stand-in), falling back to that stand-in
  // only in demo mode with nobody actually authenticated.
  const meReal = useMe()
  const decide = (code: string, decision: 'approved' | 'rejected' | 'info_requested' | 'sent_back') => {
    const c = cases.find((x) => x.code === code)
    const me = meReal ?? DEMO_USERS[viewingAs]
    if (decision === 'sent_back') {
      if (c) sendCaseBackToAsm(code, flagReason(c).summary, me.name)
      setNotice(`${code} sent back to the field team — it's now in their queue to fix and resubmit.`)
      setOpenCode(null)
      return
    }
    if (decision === 'info_requested') {
      if (c) requestInfoFromAsm({
        code, town: c.town, partnerName: c.partnerName, reviewerRole: viewingAs, reviewerName: me.name,
        note: `More information needed on ${code} before we can proceed — ${flagReason(c).summary}`,
      })
      setNotice(`Info requested on ${code} — the ASM has been notified and a case thread opened.`)
      setOpenCode(null)
      return
    }
    decideCase(code, decision, me.name)
    if (c) {
      // Leadership approving a wizard-raised case is the final sign-off — it's what actually
      // activates the candidate into a real Partner (see decideCase's becomesActive in
      // store.ts), so it gets its own distinct "Onboarding Complete" audit line and a
      // notification back to the ASE/ASM who originated it, instead of reading like just
      // another routine approval in the trail. Gated to an actual Leadership actor (not admin
      // acting on their behalf) and to firing exactly once per case (onboardingNotified).
      const onboardingComplete = decision === 'approved' && viewingAs === 'leadership'
        && c.ownerRole === 'leadership' && !!c.candidateId && !c.onboardingNotified
      logAudit({
        actor: me.name, kind: 'human',
        action: onboardingComplete ? 'Onboarding Complete' : `${decision === 'approved' ? 'Approved' : 'Rejected'} case (${ROLE_BY_CODE[viewingAs].label})`,
        entity: code,
      })
      if (onboardingComplete) {
        markOnboardingNotified(code)
        pushNotification({ title: `${code} — Onboarding Complete`, body: `${c.partnerName} has cleared final sign-off and is now an active partner.`, href: '/partners', forRole: 'ase_asm' })
      } else {
        pushNotification({ title: `${code} ${decision}`, body: `${c.partnerName} — ${decision} by ${ROLE_BY_CODE[viewingAs].label}.`, href: '/approvals' })
      }
    }
    setNotice(`${code} ${decision === 'approved' ? 'approved' : 'rejected'}.`)
    setOpenCode(null)
  }

  const toggleSelect = (code: string) =>
    setSelected((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]))
  const bulkApprove = () => {
    const me = meReal ?? DEMO_USERS[viewingAs]
    const selectedCases = selected.map((code) => cases.find((c) => c.code === code)).filter((c): c is CaseRecord => !!c)
    const codes = selectedCases.filter((c) => canDecideCase(c) && !caseDocGateBlocked(c)).map((c) => c.code)
    const blockedCount = selectedCases.filter((c) => canDecideCase(c) && caseDocGateBlocked(c)).length
    codes.forEach((code) => {
      const c = selectedCases.find((x) => x.code === code)
      decideCase(code, 'approved', me.name)
      const onboardingComplete = c?.ownerRole === 'leadership' && !!c.candidateId
      logAudit({
        actor: me.name, kind: 'human',
        action: onboardingComplete ? 'Onboarding Complete' : `Approved case (${ROLE_BY_CODE[viewingAs].label})`,
        entity: code,
      })
      if (onboardingComplete && c) {
        pushNotification({ title: `${code} — Onboarding Complete`, body: `${c.partnerName} has cleared final sign-off and is now an active partner.`, href: '/partners', forRole: 'ase_asm' })
      }
    })
    setNotice(`${codes.length} case${codes.length !== 1 ? 's' : ''} approved in bulk.`
      + (blockedCount > 0 ? ` ${blockedCount} skipped — Discontinuation Form still missing.` : ''))
    setSelected([])
  }

  // The decision itself belongs to whichever team currently owns the case, and only while it's
  // still open — "All cases"/history browsing lets Finance look at a Channel Dev case (or an
  // already-resolved one), but it shouldn't let them (re-)approve it.
  const canDecideCase = (c: CaseRecord) => (c.ownerRole === viewingAs || viewingAs === 'admin') && c.status === 'flagged'
  // Was this role ever involved with the case — not just its CURRENT ownerRole — so "Mine"
  // doesn't lose it the moment ownership moves on (e.g. Channel Development approving their own
  // check on a dual-fail candidate flips status to 'approved' while ownerRole stays
  // 'channel_dev', or a single-fail case hands ownerRole off to 'leadership' entirely). Seeded
  // cases predating involvedRoles fall back to just their current ownerRole.
  const wasInvolved = (c: CaseRecord) => (c.involvedRoles ?? [c.ownerRole]).includes(viewingAs)

  const openCase = cases.find((c) => c.code === openCode) ?? null
  // "Mine" is now the full status/history view for this persona too, not just the still-open
  // queue — a team that was ever involved (e.g. Channel Development on a dual-fail candidate
  // now sitting with Finance, or already fully approved into an active Partner) keeps seeing
  // where it ended up instead of it disappearing from their own tab the moment it resolves or
  // hands off. "All cases" broadens the same history view to every team, not just yours.
  // flaggedCases never deletes a resolved case — decideCase only flips its status/ownerRole —
  // so this is genuinely the same record all the way through, including after the candidate
  // becomes an active Partner.
  // Options for the dropdowns, derived from the cases actually in view for this persona.
  const scopedCases = cases.filter((c) => effectiveScope === 'all' || wasInvolved(c))
  const ownerOptions = [...new Set(scopedCases.map((c) => c.ownerRole))]
  const assigneeOptions = [...new Set(scopedCases.map((c) => c.assigneeId).filter(Boolean) as string[])]
  const q = search.trim().toLowerCase()
  const preRows = scopedCases
    .filter((c) => filter === 'all' || c.partnerType === filter)
    .filter((c) => statusFilter === 'all' || c.status === statusFilter)
    .filter((c) => ownerFilter === 'all' || c.ownerRole === ownerFilter)
    .filter((c) => assigneeFilter === 'all' || c.assigneeId === assigneeFilter)
    .filter((c) => !overdueOnly || c.isOverdue)
    .filter((c) => !q || c.code.toLowerCase().includes(q) || c.partnerName.toLowerCase().includes(q) || c.town.toLowerCase().includes(q))
  // Guard against the same case appearing twice. Collapse records that belong to the same
  // candidate (else the same code) into ONE row so a partner never shows up as a duplicate —
  // e.g. dual-fail siblings, or a stale record left by a persisted session before a code/owner
  // change. Keep the still-open (flagged) record over an already-decided one so the actionable
  // row is the survivor; flaggedCases is newest-first, so ties keep the most recent.
  const rank = (c: CaseRecord) => (c.status === 'flagged' ? 0 : 1)
  const byKey = new Map<string, CaseRecord>()
  for (const c of preRows) {
    const key = c.candidateId ?? c.code
    const cur = byKey.get(key)
    if (!cur || rank(c) < rank(cur)) byKey.set(key, c)
  }
  const rows = [...byKey.values()]
  const activeFilterCount = (statusFilter !== 'all' ? 1 : 0) + (ownerFilter !== 'all' ? 1 : 0) + (assigneeFilter !== 'all' ? 1 : 0) + (overdueOnly ? 1 : 0) + (q ? 1 : 0)
  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setOwnerFilter('all'); setAssigneeFilter('all'); setOverdueOnly(false) }

  if (openCase) {
    return <CaseReview c={openCase} canApprove={canDecideCase(openCase)} onBack={() => setOpenCode(null)} onDecide={decide} />
  }

  // DB Code creation is IT's job only — Finance/Channel Dev/Leadership/ASE/ASM etc. get the
  // appointment queue and their own Approve/Reject action, nothing about onboarding at all.
  const seesOnboarding = viewingAs === 'it' || viewingAs === 'admin'

  // An opened onboarding case replaces the whole page too — same reason as openCase above:
  // showing its detail stacked below the (possibly empty) appointment queue read as broken
  // clutter, not "here's what's inside this case."
  const openOnboarding = seesOnboarding && openOnboardingId ? onboardingCases.find((o) => o.id === openOnboardingId) : null
  if (openOnboarding) {
    return <OnboardingDetail ob={openOnboarding} onBack={() => setOpenOnboardingId(null)} viewingAs={viewingAs} />
  }

  return (
    <div>
      <div className="page-head">
        <h1>Approvals <span className="page-info-ic" title={isOwner && effectiveScope === 'mine'
          ? `Cases the Routing Agent sent to ${ROLE_BY_CODE[viewingAs].label} — only cases that couldn't auto-clear land here.`
          : 'Every case the agents couldn\'t auto-clear, across all partner types and owners.'}><Icon name="help" size={13} /></span></h1>
      </div>

      

      {notice && (
        <div className="notify-bar" style={{ marginBottom: '1rem' }}>
          <Icon name="approvals" size={14} /> {notice}
          <button className="btn text sm" style={{ marginLeft: 'auto' }} onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {/* IT never owns an appointment CaseRecord — this whole queue (filters, table, "Queue is
          clear" empty state) would always read as empty for them, which looked like "nothing to
          do" sitting right above a DB Code that actually needs action. IT's real queue is the
          onboarding section below; Admin still sees everything, same as before. */}
      {viewingAs !== 'it' && (<>
      <div className="row-between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.7rem' }}>
        <div className="tabs" style={{ marginBottom: 0, border: 'none' }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        {isOwner && (
          <div className="seg">
            <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>My queue</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All cases</button>
          </div>
        )}
      </div>

      <div className="apv-filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="flagged">{STATUS_LABEL.flagged}</option>
          <option value="approved">{STATUS_LABEL.approved}</option>
          <option value="rejected">{STATUS_LABEL.rejected}</option>
        </select>
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value as typeof ownerFilter)} aria-label="Filter by owner">
          <option value="all">All owners</option>
          {ownerOptions.map((r) => <option key={r} value={r}>{ROLE_BY_CODE[r]?.label ?? r}</option>)}
        </select>
        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} aria-label="Filter by assignee">
          <option value="all">All assignees</option>
          {assigneeOptions.map((id) => <option key={id} value={id}>{memberName(id)}</option>)}
        </select>
        <label className="apv-check">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
        </label>
        {activeFilterCount > 0 && (
          <button className="apv-clear" onClick={clearFilters}>Clear filters ({activeFilterCount})</button>
        )}
        <div className="apv-search">
          <Icon name="search" size={14} />
          <input placeholder="Search case, partner or town…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search cases" />
          {search && <button className="apv-search-x" onClick={() => setSearch('')} aria-label="Clear search">✕</button>}
        </div>
        <span className="apv-result-count">{rows.length} result{rows.length === 1 ? '' : 's'}</span>
      </div>

      {canApprove && selected.length > 0 && (
        <div className="notify-bar" style={{ marginBottom: '1rem' }}>
          <strong>{selected.length} selected</strong>
          <button className="btn primary sm" style={{ marginLeft: 'auto' }} onClick={bulkApprove}>Approve all selected</button>
          <button className="btn text sm" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      {rows.length === 0 ? (
        <Card><p style={{ padding: '0.5rem 0' }}>
          {activeFilterCount > 0 || filter !== 'all'
            ? <>No cases match these filters. <button className="btn text sm" onClick={() => { clearFilters(); setFilter('all') }}>Clear all</button></>
            : 'Queue is clear — no flagged cases. 🎉'}
        </p></Card>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead><tr>{canApprove && <th></th>}<th>Case</th><th>Partner</th><th>Type</th><th>Town</th><th>Owner</th><th>Assignee</th><th>Status</th><th>Confidence</th><th>SLA</th><th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.code} className="clickable" onClick={() => setOpenCode(c.code)}>
                  {canApprove && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {canDecideCase(c) && (
                        <input type="checkbox" checked={selected.includes(c.code)} onChange={() => toggleSelect(c.code)} aria-label={`Select ${c.code}`} />
                      )}
                    </td>
                  )}
                  <td><span className="code">{c.code}</span></td>
                  <td className="strong">{c.partnerName}{c.subtype === 'replacement' && <> <Pill tone="warn">Replacement</Pill></>}</td>
                  <td><span className="type-badge"><span className="d" style={{ background: PARTNER_TYPE_COLOR[c.partnerType] }} />{partnerTypeLabel(c.partnerType).split(' ')[0]}</span></td>
                  <td>{c.town}, {c.state}</td>
                  <td style={{ textTransform: 'capitalize' }}>{c.ownerRole.replace('_', ' ')}</td>
                  <td>{c.assigneeId ? <>{memberName(c.assigneeId)}{c.escalated && <> <Pill tone="crit">Escalated</Pill></>}</> : <span className="muted-note" style={{ margin: 0 }}>Unassigned</span>}</td>
                  <td>{(() => {
                    const sibling = siblingStillOpen(c, cases)
                    return sibling
                      ? <span title={`Cleared here — still waiting on ${REVIEW_TEAM_LABEL[sibling.ownerRole] ?? sibling.ownerRole}'s evaluation before this reaches Leadership`}>
                          <Pill tone="warn" dot>Awaiting {REVIEW_TEAM_LABEL[sibling.ownerRole] ?? sibling.ownerRole}</Pill>
                        </span>
                      : <Pill tone={STATUS_TONE[c.status]} dot>{STATUS_LABEL[c.status]}</Pill>
                  })()}</td>
                  <td className="num tnum"><Pill tone={confidenceTone(c.confidencePct)} dot>{c.confidencePct}%</Pill></td>
                  <td>{c.status !== 'flagged'
                    ? <span className="muted-note" style={{ margin: 0 }}>—</span>
                    : c.slaDueAt != null
                      ? <Pill tone={SLA_TONE[liveSlaState(c.slaDueAt)]} dot>{liveSlaLabel(c.slaDueAt)}</Pill>
                      : c.isOverdue ? <Pill tone="crit" dot>Overdue</Pill> : <Pill tone="warn" dot>{c.slaLabel}</Pill>}</td>
                  <td><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setOpenCode(c.code) }}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>)}

      {seesOnboarding && <OnboardingPanel onOpen={setOpenOnboardingId} />}
    </div>
  )
}

// Priority reads off the same live SLA clock the case's SLA pill already uses — overdue is
// High, due-soon is Medium, on-track is Low. Never a fixed/fabricated value.
const SLA_PRIORITY_LABEL: Record<'good' | 'warn' | 'crit', string> = { good: 'Low', warn: 'Medium', crit: 'High' }

/* ---------------- Workflow & assignment (case-management spine, in-line) ---------------- */
// Process Progress — the numbered stepper + "you are currently working on" banner, un-wrapped by
// a Card title (matches the reference screen: this sits as its own bordered block right below
// the hero tiles, with no header text of its own). Split out of CaseWorkflow below so it can be
// positioned exactly where the image puts it, ahead of Case Details / What's going on / Your action.
// Controlled: `viewState` is which stage's content the page below is currently showing (null =
// the case's real live stage). Clicking a step here is what actually switches that content —
// previously a click only opened a description tooltip while the whole page underneath stayed
// fixed to the live stage, which is why every stage read as "one giant wall of the same cards."
function CaseStepper({ c, viewState, onPick }: { c: CaseRecord; viewState: string | null; onPick: (s: string | null) => void }) {
  const type = c.caseType ?? 'appointment'
  const current = c.caseState ?? START_STATE[type] ?? ''
  const ladder = STATE_ORDER[type] ?? []
  const currentIdx = ladder.indexOf(current)
  const isTerminal = TERMINAL_STATES.has(current)
  const offPath = current === 'REJECTED' || current === 'CANCELLED'
  const picked = viewState ?? current
  const slaTone = c.slaDueAt != null ? SLA_TONE[liveSlaState(c.slaDueAt)] : undefined

  return (
    <Card>
      <div className="cw-stepper">
        {ladder.map((st, i) => (
          <button type="button" key={st} className={`cw-step ${i < currentIdx ? 'done' : ''} ${st === current ? 'now' : ''} ${picked === st ? 'picked' : ''}`}
            onClick={() => onPick(st === current ? null : st)} title={STATE_DESC[st] ?? stateLabel(st)}>
            <span className="cw-step-dot">{i < currentIdx ? <Icon name="check" size={11} /> : i + 1}</span>
            <span className="cw-step-text">
              <span className="cw-step-lbl">{stateLabel(st)}</span>
              <span className="cw-step-cap">{i < currentIdx ? 'Completed' : st === current ? 'In progress' : 'Pending'}</span>
            </span>
          </button>
        ))}
        {offPath && (
          <div className="cw-step now off">
            <span className="cw-step-dot"><Icon name="close" size={11} /></span>
            <span className="cw-step-text"><span className="cw-step-lbl">{stateLabel(current)}</span></span>
          </div>
        )}
      </div>
      {/* Viewing a stage other than the live one shows ONLY that stage's own info — completed
          stages read "Completed", the live stage's own banner shows below, and upcoming stages
          read "Pending" — so the two boxes never show conflicting stages at once. */}
      {viewState && viewState !== current && (
        <div className="cw-state-desc">
          <Icon name="info" size={12} />
          <div>
            <div className="cw-state-desc-title"><b>{stateLabel(viewState)}</b> — {ladder.indexOf(viewState) < currentIdx ? 'Completed' : 'Pending'}</div>
            <div>{STATE_DESC[viewState] ?? '—'}</div>
          </div>
        </div>
      )}

      {!isTerminal && !offPath && !viewState && (
        <div className="cw-current-banner">
          <Icon name="info" size={14} />
          <div className="cw-current-body">
            <div className="cw-current-title">You are currently working on: <b>{stateLabel(current)}</b></div>
            <div className="cw-current-desc">{STATE_DESC[current] ?? '—'}</div>
          </div>
          <div className="cw-current-due">
            {c.slaDueAt != null && slaTone
              ? <Pill tone={slaTone} dot>Due in: {liveSlaLabel(c.slaDueAt)}</Pill>
              : <Pill tone="ai" dot>In progress</Pill>}
          </div>
        </div>
      )}
    </Card>
  )
}

/* ---------------- Workflow & assignment (case-management spine, in-line) ---------------- */
function CaseWorkflow({ c }: { c: CaseRecord }) {
  const reassignCase = useApp((s) => s.reassignCase)
  const escalateCase = useApp((s) => s.escalateCase)
  const availabilityByUser = useApp((s) => s.availabilityByUser)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const actorName = useMe()?.name ?? DEMO_USERS[viewingAs]?.name ?? 'You'
  const [escMsg, setEscMsg] = useState<string | null>(null)

  const type = c.caseType ?? 'appointment'
  const current = c.caseState ?? START_STATE[type] ?? ''
  const peers = eligibleMembers(c.ownerRole, c.state).filter((m) => m.id !== c.assigneeId)
  const isTerminal = TERMINAL_STATES.has(current)
  const offPath = current === 'REJECTED' || current === 'CANCELLED'
  const slaTone = c.slaDueAt != null ? SLA_TONE[liveSlaState(c.slaDueAt)] : undefined
  // Reassigning/escalating a case is a supervisor action — only RBL or ASM can hand it to someone
  // else (admin keeps it for support). An ASE (or any other reviewing role) can see who owns it,
  // but never gets the controls to move it.
  const canReassign = viewingAs === 'rbl' || viewingAs === 'asm' || viewingAs === 'admin'

  return (
    <Card title={`Workflow & Assignment — ${CASE_TYPE_LABEL[type]}`}>
      {c.slaDueAt != null && !isTerminal && (
        <div className="cw-sla">
          <span>Case SLA</span>
          <Pill tone={SLA_TONE[liveSlaState(c.slaDueAt)]} dot>{liveSlaLabel(c.slaDueAt)}</Pill>
          <span className="cw-sla-due">due {stamp(c.slaDueAt)}{c.slaAnchorAt != null ? ` · Day D ${stamp(c.slaAnchorAt)}` : ''}</span>
        </div>
      )}

      <div className="cw-assign">
        <div className="cw-assign-kv">
          <span>Assignee</span>
          <b>{c.assigneeId ? memberName(c.assigneeId) : 'Unassigned'}{c.escalated && <> <Pill tone="crit">Escalated</Pill></>}</b>
        </div>
        {!isTerminal && !offPath && slaTone && (
          <div className="cw-assign-kv">
            <span>Priority</span>
            <b><Pill tone={slaTone} dot>{SLA_PRIORITY_LABEL[slaTone]}</Pill></b>
          </div>
        )}
        {canReassign && (
          <div className="cw-assign-actions">
            <select defaultValue="" onChange={(e) => { if (e.target.value) reassignCase(c.code, e.target.value, actorName, 'from case review') }} title="Reassign to">
              <option value="">Reassign…</option>
              {peers.map((p) => (
                <option key={p.id} value={p.id} disabled={!isUserAvailable(p.id, availabilityByUser)}>
                  {p.name} ({p.level}){!isUserAvailable(p.id, availabilityByUser) ? ' — on leave' : ''}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={() => {
              const to = escalateCase(c.code, actorName, 'from case review')
              setEscMsg(to ? `Escalated to ${to}.` : 'Already at the top of the chain — no one to escalate to.')
            }}><Icon name="alert" size={13} /> Escalate</Button>
          </div>
        )}
      </div>
      {escMsg && <div className="cw-esc-msg"><Icon name="check" size={13} /> {escMsg}</div>}

      <div className="cw-timeline">
        <div className="cw-timeline-h">Activity Log</div>
        <CaseTimeline events={c.events} empty="No workflow activity recorded yet." />
      </div>
    </Card>
  )
}

// Which of the 3 content-phases a given lifecycle STATE belongs to — the same grouping the page
// used to derive only off the case's live state (stagePhase), now generalized so it can classify
// ANY stepper node, including ones you're just previewing rather than the case's real one.
function phaseForState(state: string): 'review' | 'signoff' | 'closed' {
  if (state === 'LEADERSHIP_SIGNOFF') return 'signoff'
  if (TERMINAL_STATES.has(state)) return 'closed'
  return 'review'
}

/* ---------------- Case review ---------------- */
function CaseReview({ c, canApprove, onBack, onDecide }:
  { c: CaseRecord; canApprove: boolean; onBack: () => void; onDecide: (code: string, d: 'approved' | 'rejected' | 'info_requested' | 'sent_back') => void }) {
  // Reachable via "All cases" once a case is no longer flagged (see Approvals' rows filter) —
  // browsable forever for history/status, but never re-decidable.
  const isResolved = c.status !== 'flagged'
  const allCases = useApp((s) => s.flaggedCases)
  const parkedOn = siblingStillOpen(c, allCases)
  // Once activated, the case hands off to a separate OnboardingCase for IT to create the DB
  // Code (see buildOnboardingCase in store.ts) — that's a different record entirely, invisible
  // from here otherwise. Anyone viewing this case (including the ASE/ASM who can't open
  // Onboarding itself — that's IT/Admin only) can still see whether IT has finished it and what
  // the resulting DB Code actually is, read-only.
  const onboardingCases = useApp((s) => s.onboardingCases)
  const partners = useApp((s) => s.partners)
  const linkedOnboarding = onboardingCases.find((o) => o.parentCaseCode === c.code)
  const linkedPartner = linkedOnboarding?.partnerId ? partners.find((p) => p.id === linkedOnboarding.partnerId) : undefined
  const { summary, lines } = flagReason(c)
  const setCopilotOpen = useApp((s) => s.setCopilotOpen)
  const setCopilotAgent = useApp((s) => s.setCopilotAgent)
  const openCaseDiscussion = useApp((s) => s.openCaseDiscussion)
  const candidates = useApp((s) => s.candidates)
  const logAudit = useApp((s) => s.logAudit)
  const pushNotification = useApp((s) => s.pushNotification)
  const uploadCaseFinanceDoc = useApp((s) => s.uploadCaseFinanceDoc)
  const addCaseNoteForLeadership = useApp((s) => s.addCaseNoteForLeadership)
  const auditLog = useApp((s) => s.auditLog)
  const commThreads = useApp((s) => s.commThreads)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const slaCfg = useApp((s) => s.slaConfig)
  const me = useMe() ?? DEMO_USERS[viewingAs]
  const navigate = useNavigate()
  const linked = c.hasDiscontinuationForm
  const blocked = c.subtype === 'replacement' && !linked
  const [discFormOpen, setDiscFormOpen] = useState(false)
  const [confWhyOpen, setConfWhyOpen] = useState(false)
  const [journeyPick, setJourneyPick] = useState<string | null>(null)
  const [authPick, setAuthPick] = useState<string | null>(null)

  const askCopilot = () => { setCopilotAgent('evaluation'); setCopilotOpen(true) }
  const discussLabel = viewingAs === 'ase_asm' ? 'Reply in case thread' : 'Communication Agent'
  const discuss = () => {
    openCaseDiscussion({ code: c.code, town: c.town, partnerName: c.partnerName })
    navigate('/communication')
  }

  // Two ways to reach the ASM or the distributor: a real (mock) outbound email, or the
  // internal Communication Agent thread — reviewer picks whichever fits, instead of one
  // button silently deciding for them.
  const asmUser = DEMO_USERS.ase_asm // the ASM this prototype's cases are attributed to
  const distributorEmail = emailForCase(c, candidates)
  type EmailTarget = 'distributor' | 'asm'
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailSentNote, setEmailSentNote] = useState<string | null>(null)
  const emailTo = emailTarget === 'asm' ? asmUser.email : distributorEmail
  const emailRecipientName = emailTarget === 'asm' ? asmUser.name : c.partnerName
  // When Leadership's final sign-off opens this composer (see approveWithConditions below),
  // sending the email is also what actually completes the approval — one confirmed action
  // instead of the decision silently firing before the distributor's even been told.
  const [completingOnboarding, setCompletingOnboarding] = useState(false)
  const openEmail = (target: EmailTarget) => {
    setEmailTarget(target)
    setEmailSentNote(null)
    if (target === 'asm') {
      setEmailSubject(`${c.code} — need your input`)
      setEmailBody(`Hi ${asmUser.name},\n\n${summary}\n\nCan you share any context that would help ${ROLE_BY_CODE[viewingAs].label} decide on ${c.partnerName} (${c.code})?\n\nThanks,\n${me.name}`)
    } else {
      setEmailSubject(`Action needed on your application — ${c.code}`)
      setEmailBody(`Hi ${c.partnerName} team,\n\nWe're reviewing your application (${c.code}) and need your help closing out one item:\n\n${summary}\n\nCould you share an update or supporting documents at your earliest convenience?\n\nThanks,\n${me.name}\n${ROLE_BY_CODE[viewingAs].label}, RCPL`)
    }
  }
  const openOnboardingCompleteEmail = () => {
    setEmailTarget('distributor')
    setEmailSentNote(null)
    setCompletingOnboarding(true)
    setEmailSubject(`Welcome to RCPL — ${c.partnerName} onboarding complete`)
    setEmailBody(`Hi ${c.partnerName} team,\n\nGreat news — your onboarding (${c.code}) has cleared final sign-off and you're now live as an RCPL partner.${hasConditions ? `\n\nA few things to keep in mind:\n${conditions.map((cond) => `- ${cond}`).join('\n')}` : ''}\n\nWelcome aboard — looking forward to working together.\n\nRegards,\n${me.name}\n${ROLE_BY_CODE[viewingAs].label}, RCPL`)
  }
  const [sendingEmail, setSendingEmail] = useState(false)
  const [sendEmailError, setSendEmailError] = useState<string | null>(null)
  // Real SMTP send (same backend endpoint the intake "request missing info" reply uses) —
  // every email action on this screen (Email ASM, Email/Request from distributor, Complete
  // Onboarding) genuinely reaches the recipient's inbox instead of only logging that it did.
  const sendEmail = async () => {
    setSendingEmail(true)
    setSendEmailError(null)
    try {
      const res = await fetch('/api/mail/reply', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: emailTo, subject: emailSubject, text: emailBody }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Send failed (${res.status})`)
      logAudit({ actor: me.name, kind: 'human', action: `Emailed ${emailRecipientName} (${emailTo}) re: ${c.code}`, entity: c.code })
      if (completingOnboarding) {
        if (hasConditions) logAudit({ actor: me.name, kind: 'human', action: `Approved with conditions (${conditions.join('; ')})`, entity: c.code })
        onDecide(c.code, 'approved')
        setCompletingOnboarding(false)
      } else {
        setEmailSentNote(`Email sent to ${emailTo} just now.`)
        setEmailTarget(null)
      }
    } catch (err) {
      setSendEmailError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSendingEmail(false)
    }
  }

  // Note for Leadership — persisted on the case itself (notesForLeadership) so it's actually
  // readable once the case reaches their queue, plus the one-time notification/audit line for
  // immediate visibility.
  const [leadershipNote, setLeadershipNote] = useState('')
  const [leadershipSentNote, setLeadershipSentNote] = useState<string | null>(null)
  const sendLeadershipNote = () => {
    if (!leadershipNote.trim()) return
    addCaseNoteForLeadership(c.code, me.name, leadershipNote.trim())
    pushNotification({ title: `Note on ${c.code} from ${ROLE_BY_CODE[viewingAs].label}`, body: leadershipNote.trim(), href: '/approvals', forRole: 'leadership' })
    logAudit({ actor: me.name, kind: 'human', action: `Left a note for Leadership on ${c.code}`, entity: c.code })
    setLeadershipSentNote('Leadership has been notified.')
    setLeadershipNote('')
  }

  // AI Recommendation hero + Decision Panel — derived entirely from real case data. `cc` fills
  // in a numeric snapshot from the flag text itself when the case predates/lacks a structured
  // one (older persisted cases), so the real percentage/score is never silently hidden.
  const cc: CaseRecord = { ...c, financeSnapshot: deriveFinanceSnapshot(c), channelSnapshot: deriveChannelSnapshot(c) }
  // The candidate this case was raised from, when it's a live case — the only source for its
  // real total turnover (CaseRecord itself only carries expectedTurnover, the RCPL slice of it).
  const linkedCandidate = candidates.find((x) => x.id === c.candidateId)
  // Deck slides 6–7 (authority + SLA) and slide 3/13 (ROI + ≥20% contribution) — read-only, derived
  // from the expected-turnover band and the recommendation's committed figures (prototype constants).
  const caseTurnover = c.expectedTurnover ?? EXPECTED_RCPL_TURNOVER
  const authBand = authorityFor(caseTurnover)
  // This case's own required investment when it carries a real snapshot (live cases always do,
  // post-Bug-A-fix); only seeded/legacy cases without one fall back to the flat reference figure.
  const roiPct = computeRoi(caseTurnover, cc.financeSnapshot?.requiredInvestment ?? REQUIRED_INVESTMENT)
  // RCPL's real share of this DB's overall business when a linked candidate carries its total
  // turnover; only seeded/legacy cases with no linked candidate fall back to the reference figure.
  const contributionPct = linkedCandidate ? contributionPctFor(linkedCandidate.turnoverMonthly, linkedCandidate.expectedRcplTurnover) : 20.5
  const teamLabel = TEAM_LABEL[c.ownerRole]
  // Everything Leadership needs to see before final sign-off: the full audit trail (approvals,
  // rejections, emails, notes) plus the case's internal chat thread — not just a blank note box.
  const auditTrail = getCaseAuditTrail(c.code, auditLog)
  const thread = commThreads.find((t) => t.code === c.code)
  const risk = riskLevel(gapRatioFor(cc))
  const [traceOpen, setTraceOpen] = useState(false)
  const insights = aiInsights(cc, summary)
  const journey = journeySteps(c, teamLabel, !!linkedPartner?.dbCode)
  // Same ladder CaseWorkflow's stepper reads off — reused here just for the "Stage X of Y"
  // subtitle under the page heading, so it appears before scrolling to the workflow card.
  const caseType = c.caseType ?? 'appointment'
  const ladder = STATE_ORDER[caseType] ?? []
  const currentState = c.caseState ?? START_STATE[caseType] ?? ''
  const currentStageIdx = ladder.indexOf(currentState)
  const isCaseTerminal = TERMINAL_STATES.has(currentState)
  // Which stage the page is actually SHOWING right now — defaults to the case's real live stage,
  // but clicking a different node on the stepper switches this to preview that stage instead.
  // This is what makes the stages genuinely separate screens instead of one page where every
  // card for every phase sat stacked together regardless of which stepper node you looked at.
  const [viewState, setViewState] = useState<string | null>(null)
  const effectiveViewState = viewState ?? currentState
  const isViewingLive = effectiveViewState === currentState
  // Which cards actually apply at the VIEWED stage — previously every card showed regardless of
  // stage (Financial Snapshot/Financials Verification/Authority-ROI/Follow-up all visible even on
  // an already-closed case), which read as one undifferentiated wall of content.
  // 'review': Finance/Trade Marketing's own check is still open (Submitted/Under Review) — their
  // evaluation snapshot, document gate, and follow-up actions are what's actually actionable.
  // 'signoff': both checks cleared, sitting with Leadership — the snapshot's already resolved, so
  // Authority/ROI/SLA (Leadership's OWN decision criteria) takes its place.
  // 'closed': terminal (Active/Rejected/Cancelled) — read-only recap, no more actions to take.
  const stagePhase: 'review' | 'signoff' | 'closed' = phaseForState(effectiveViewState)
  // Priority for the Case Details card — same live-SLA-bucket read the Workflow card's own
  // Priority pill already uses, so the two never disagree.
  const caseSlaTone = c.slaDueAt != null ? SLA_TONE[liveSlaState(c.slaDueAt)] : undefined
  const hasConditions = !!(cc.financeSnapshot || cc.channelSnapshot)
  const conditions: string[] = ['ASM confirmation required']
  if (cc.financeSnapshot) conditions.push(`Distributor to infuse ₹${Math.ceil(cc.financeSnapshot.fundingGap)}L capital`)
  if (cc.channelSnapshot) conditions.push(`Distributor to close the coverage gap (${cc.channelSnapshot.gap.toFixed(1)}/10) before next review`)
  conditions.push('Review after 90 days')

  // Finance cases gate on one real document — the distributor's bank statement, which is what
  // actually backs the Own Funds / CC Limit figures — not a checklist of unrelated paperwork.
  const financeDocs = c.financeDocsUploaded ?? {}
  const bankStatementFileInput = useRef<HTMLInputElement | null>(null)
  const bankStatementDoc = financeDocs[BANK_STATEMENT_KEY]
  // No longer a hard block — just flags that the bank statement isn't on file yet, so Approve
  // can surface a "continue anyway?" confirmation instead of disabling the button outright.
  const financeGateBlocked = !!cc.financeSnapshot && !bankStatementDoc
  const bankStatementPdf = () => cc.financeSnapshot && buildPdf([
    { text: 'RCPL Partner Platform — Bank Statement Summary', size: 9, gap: 18 },
    { text: c.partnerName, size: 18, bold: true, gap: 30 },
    { text: `Account type: Cash Credit (CC) · ${c.town}, ${c.state}`, size: 10.5, gap: 22 },
    { text: 'Financials', size: 13, bold: true, gap: 22 },
    { text: `Total Own Funds / Borrowed (₹L):   ${cc.financeSnapshot.ownFunds}`, size: 11, gap: 18 },
    { text: `CC Limit (₹L):   ${cc.financeSnapshot.ccLimit}`, size: 11, gap: 18 },
    { text: ' ', gap: 6 },
    { text: `Total Available Capital (₹L):   ${cc.financeSnapshot.capitalAvailable}`, size: 11, gap: 18 },
    { text: `Required Investment (₹L):   ${cc.financeSnapshot.requiredInvestment}`, size: 11, gap: 18 },
    { text: ' ', gap: 20 },
    { text: 'Generated preview PDF — prototype stand-in for the actual bank statement.', size: 8.5 },
  ])

  // Attachments — only the linked candidate's real received documents (from its intake
  // extraction); no attachments card at all when there's nothing real to point to.
  const linkedExt = linkedCandidate?.sourceIntakeId ? EXTRACTIONS[linkedCandidate.sourceIntakeId] : undefined
  const attachments = linkedExt?.documents?.filter((d) => d.received) ?? []
  const previewDoc = (d: RequiredDoc) => openPdfInNewTab(buildPdf([
    { text: 'RCPL Partner Platform — Document on file', size: 9, gap: 18 },
    { text: d.name, size: 18, bold: true, gap: 30 },
    { text: c.partnerName, size: 11, gap: 20 },
    { text: `Status: Received${d.file ? ` — ${d.file}` : ''}`, size: 10.5, gap: 18 },
    { text: ' ', gap: 20 },
    { text: 'Generated preview PDF — prototype stand-in for the actual scan.', size: 8.5 },
  ]))
  // "Key Documents" — the linked candidate's real received documents, plus the bank statement
  // once uploaded (Financials Verification's own upload — same file, just also surfaced here).
  const keyDocuments: { key: string; name: string; sub?: string; view: () => void }[] = [
    ...(bankStatementDoc ? [{
      key: 'bank_statement', name: 'Bank Statement', sub: bankStatementDoc.name,
      view: () => { if (bankStatementDoc.dataUrl) window.open(bankStatementDoc.dataUrl, '_blank'); else { const b = bankStatementPdf(); if (b) openPdfInNewTab(b) } },
    }] : []),
    ...attachments.map((d) => ({ key: d.name, name: d.name, view: () => previewDoc(d) })),
  ]

  // Leadership approving a wizard-raised case is the final sign-off — the same "becomes a real
  // Partner" transition decideCase makes in store.ts — so instead of deciding silently, it opens
  // the onboarding-complete email to the distributor first; sending it is what actually confirms
  // the approval (see sendEmail above).
  const isFinalOnboardingApproval = viewingAs === 'leadership' && c.ownerRole === 'leadership' && !!c.candidateId
  const [approveMenuOpen, setApproveMenuOpen] = useState(false)
  const approveWithConditions = () => {
    if (isFinalOnboardingApproval) { openOnboardingCompleteEmail(); return }
    if (hasConditions) logAudit({ actor: me.name, kind: 'human', action: `Approved with conditions (${conditions.join('; ')})`, entity: c.code })
    onDecide(c.code, 'approved')
  }
  const approvePlain = () => {
    setApproveMenuOpen(false)
    if (isFinalOnboardingApproval) { openOnboardingCompleteEmail(); return }
    onDecide(c.code, 'approved')
  }
  // The bank statement is no longer a hard gate — approving without it just asks the reviewer
  // to confirm they're ready to continue (they can leave a Note for Leadership above first).
  const [confirmNoDocKind, setConfirmNoDocKind] = useState<'plain' | 'conditions' | null>(null)
  const requestApprove = (kind: 'plain' | 'conditions') => {
    if (financeGateBlocked) { setConfirmNoDocKind(kind); return }
    if (kind === 'plain') approvePlain(); else approveWithConditions()
  }
  const confirmApproveWithoutDoc = () => {
    const kind = confirmNoDocKind
    setConfirmNoDocKind(null)
    if (kind === 'plain') approvePlain(); else if (kind === 'conditions') approveWithConditions()
  }

  return (
    <div>
      <div className="page-head">
        <div className="row-between">
          <h1>Review · {c.partnerName} <span className="page-info-code">({c.code})</span>{' '}
            <Pill tone={isResolved ? (c.status === 'approved' ? 'good' : 'crit') : 'ai'} dot>{isResolved ? STATUS_LABEL[c.status] : stateLabel(currentState)}</Pill>{' '}
            <span className="page-info-ic" title={`${c.town}, ${c.state} · owned by ${c.ownerRole.replace('_', ' ')}`}><Icon name="help" size={13} /></span></h1>
          <Button variant="text" onClick={onBack}>← Back to queue</Button>
        </div>
        {ladder.length > 0 && (
          <p className="cr-stage-sub">Stage {Math.max(0, currentStageIdx) + 1} of {ladder.length} · {CASE_TYPE_LABEL[caseType]}</p>
        )}
      </div>

      <div className="cr-layout with-panel">
        <div className="cr-main">
          <div className="cr-hero">
            <div className="cr-hero-col">
              <div className="cr-hero-label"><Icon name="help" size={12} /> AI RECOMMENDATION</div>
              <div className="cr-hero-route">Route to {teamLabel}</div>
              <Pill tone="warn">Needs {teamLabel} Review</Pill>
            </div>
            <div className="cr-hero-col center">
              <div className="cr-hero-label">Confidence Score</div>
              <button type="button" className="cr-gauge-btn" onClick={() => setConfWhyOpen(true)} title="See why — how this score is calculated">
                <ArcGauge pct={c.confidencePct} />
                <div className="arc-gauge-caption">
                  {c.confidencePct >= 70 ? 'High Confidence' : c.confidencePct >= 50 ? 'Medium Confidence' : 'Low Confidence'} <Icon name="help" size={11} />
                </div>
              </button>
            </div>
            <div className="cr-hero-col">
              <div className="cr-hero-label">Risk Level</div>
              <Pill tone={risk.tone}>{risk.label}</Pill>
              <p className="cr-hero-reason">{summary}</p>
              <button className="cr-hero-toggle" onClick={() => setTraceOpen((v) => !v)}>{traceOpen ? '▲ Hide details' : 'View details →'}</button>
            </div>
            <div className="cr-hero-col">
              <div className="cr-hero-label">SLA Status</div>
              {isCaseTerminal || c.slaDueAt == null ? (
                <Pill tone="neutral">{isCaseTerminal ? 'Closed' : '—'}</Pill>
              ) : (
                <>
                  <div className="cr-hero-sla"><Icon name="clock" size={14} /> {liveSlaLabel(c.slaDueAt)}</div>
                  <p className="cr-hero-reason">Due {stamp(c.slaDueAt)}</p>
                </>
              )}
            </div>
          </div>
          {traceOpen && <AgentTrace lines={lines} />}

          <Modal open={confWhyOpen} onClose={() => setConfWhyOpen(false)} title="Why this score?">
            {cc.financeSnapshot ? (() => {
              const f = cc.financeSnapshot
              const met = f.readinessPct >= 100
              return (
                <>
                  <p className="cr-why-say">
                    <b>{c.partnerName} has {f.readinessPct}% of the money needed</b> to run this distributorship.
                    They've got <b>₹{Math.round(f.capitalAvailable)}L</b> but need <b>₹{Math.round(f.requiredInvestment)}L</b>
                    {met ? ' — fully covered.' : <> — <b className="cr-why-gap">₹{Math.round(f.fundingGap)}L short</b>.</>}
                  </p>
                  <div className="cr-why-meter">
                    <div className="cr-why-bar"><i style={{ width: `${Math.min(100, f.readinessPct)}%` }} /></div>
                    <div className="cr-why-scale"><span>Has ₹{Math.round(f.capitalAvailable)}L</span><span>Needs ₹{Math.round(f.requiredInvestment)}L</span></div>
                  </div>
                  <p className="cr-why-because">
                    {met ? 'This meets the funding bar.' : `That ₹${Math.round(f.fundingGap)}L gap is why the case was routed to Finance — it clears once funds reach ₹${Math.round(f.requiredInvestment)}L (100%).`}
                  </p>
                </>
              )
            })() : cc.channelSnapshot ? (() => {
              const ch = cc.channelSnapshot
              const met = ch.readinessPct >= 100
              return (
                <>
                  <p className="cr-why-say">
                    <b>{c.partnerName}'s infrastructure &amp; coverage scores {ch.score.toFixed(1)} out of the {ch.threshold} needed</b> — that's {ch.readinessPct}% of the benchmark
                    {met ? ', which meets the bar.' : <>, a <b className="cr-why-gap">{ch.gap.toFixed(1)}-point shortfall</b>.</>}
                  </p>
                  <div className="cr-why-meter">
                    <div className="cr-why-bar"><i style={{ width: `${Math.min(100, ch.readinessPct)}%` }} /></div>
                    <div className="cr-why-scale"><span>Scores {ch.score.toFixed(1)}/10</span><span>Needs {ch.threshold}/10</span></div>
                  </div>
                  <p className="cr-why-because">
                    {met ? 'This meets the coverage benchmark.' : `That gap is why the case was routed to Trade Marketing — it clears at ${ch.threshold}/10.`}
                  </p>
                </>
              )
            })() : (
              <p className="cr-why-say">{summary}</p>
            )}
            <p className="cr-why-note"><Icon name="info" size={12} /> This shows <b>how much of the requirement is already met</b> — not the chance of approval. A flagged case can read high here and still fall short.</p>
          </Modal>

          <CaseStepper c={c} viewState={viewState} onPick={setViewState} />

          {!isViewingLive && (
            <div className="notify-bar" style={{ marginTop: 0, marginBottom: '1rem' }}>
              <Icon name="info" size={14} /> Previewing <b>{stateLabel(effectiveViewState)}</b> — read-only. The case is actually at <b>{stateLabel(currentState)}</b>.
              <button className="btn text sm" style={{ marginLeft: 'auto' }} onClick={() => setViewState(null)}>Back to current stage</button>
            </div>
          )}

          <Card title="Case Details">
            <div className="cr-details-grid">
              <div className="cr-detail-f cr-detail-partner"><span className="cr-detail-ic"><Icon name="partners" size={15} /></span>
                <div><span className="cr-detail-k">Distributor / Partner</span>
                  <span className="cr-detail-v cr-detail-link">{c.partnerName}<div className="cr-detail-sub">{c.town}, {c.state}</div></span></div></div>
              <div className="cr-detail-f"><span className="cr-detail-k">Case Type</span>
                <span className="cr-detail-v">{CASE_TYPE_LABEL[caseType]}</span></div>
              <div className="cr-detail-f"><span className="cr-detail-k">Case ID</span>
                <span className="cr-detail-v">{c.code} <Pill tone="ai">{SUBTYPE_DB_LABEL[c.subtype] ?? c.subtype}</Pill></span></div>
              {linkedOnboarding && (
                <div className="cr-detail-f"><span className="cr-detail-k">DB Code</span>
                  <span className="cr-detail-v">
                    {linkedPartner?.dbCode
                      ? <><Pill tone="good">{linkedPartner.dbCode}</Pill><div className="cr-detail-sub">Created by IT — onboarding complete</div></>
                      : <><Pill tone="warn" dot>Pending with IT</Pill><div className="cr-detail-sub">{linkedOnboarding.code} — IT hasn't created the DB Code yet</div></>}
                  </span>
                </div>
              )}
              <div className="cr-detail-f"><span className="cr-detail-k">Assignee</span>
                <span className="cr-detail-v">{c.assigneeId ? memberName(c.assigneeId) : 'Unassigned'}{c.assigneeId && <Pill tone="neutral">{ROLE_BY_CODE[c.ownerRole]?.label ?? c.ownerRole}</Pill>}</span></div>
              <div className="cr-detail-f"><span className="cr-detail-k">Priority</span>
                <span className="cr-detail-v">{caseSlaTone ? <Pill tone={caseSlaTone} dot>{SLA_PRIORITY_LABEL[caseSlaTone]}</Pill> : '—'}</span></div>
              <div className="cr-detail-f"><span className="cr-detail-k">SLA</span>
                <span className="cr-detail-v">{c.slaDueAt != null && !isCaseTerminal
                  ? <><Pill tone={caseSlaTone} dot>{liveSlaLabel(c.slaDueAt)}</Pill><div className="cr-detail-sub">Due {stamp(c.slaDueAt)}</div></>
                  : <span className="muted-note" style={{ margin: 0 }}>—</span>}</span></div>
            </div>
          </Card>

          <Card>
            <div className="cr-wgo-grid">
              <div className="cr-wgo-col">
                <div className="cr-detail-k">What's going on</div>
                <div className="cr-wgo-headline">{isCaseTerminal ? stateLabel(currentState) : `Awaiting ${teamLabel} review`}</div>
                <p className="cr-wgo-desc">{STATE_DESC[currentState] ?? summary}</p>
              </div>
              <div className="cr-wgo-col">
                <div className="cr-detail-k">Current state</div>
                <div className="cr-wgo-headline"><Pill tone={isCaseTerminal ? (currentState === 'ACTIVE' ? 'good' : 'crit') : 'ai'} dot>{stateLabel(currentState)}</Pill></div>
                <p className="cr-wgo-desc"><Icon name="info" size={12} /> The case advances automatically as the Approve / Reject decision below is taken — each move is recorded on the timeline.</p>
              </div>
            </div>
          </Card>

          {!canApprove && !isResolved && (
            <div className="wizard-foot" style={{ borderTop: 'none' }}>
              <span className="muted-note" style={{ margin: 0 }}>
                This case is owned by <strong style={{ textTransform: 'capitalize' }}>{c.ownerRole.replace('_', ' ')}</strong> — the approve/reject decision is theirs. You can respond in the thread or email the distributor.
              </span>
            </div>
          )}

          <CaseWorkflow c={c} />

          {stagePhase !== 'closed' && (
          <Card title="Authority, ROI & SLA">
            <div className="cr-tiles">
              <button type="button" className="cr-tile cr-tile-btn" onClick={() => setAuthPick(authPick === 'band' ? null : 'band')} title="Turnover band → who recommends & finalises"><span className="cr-tile-ic"><Icon name="user" size={15} /></span>
                <div><div className="cr-tile-v">{authBand.label}</div><div className="cr-tile-k">Turnover band</div>
                  <div className="cr-tile-cap" style={{ color: 'var(--ink-mute)' }}>Recommend {authBand.recommend} · Finalise {authBand.finalise}</div></div></button>
              <button type="button" className="cr-tile cr-tile-btn" onClick={() => setAuthPick(authPick === 'chain' ? null : 'chain')} title="Approval chain"><span className="cr-tile-ic"><Icon name="shield" size={15} /></span>
                <div><div className="cr-tile-v">L1 → L2</div><div className="cr-tile-k">Approval chain</div>
                  <div className="cr-tile-cap" style={{ color: 'var(--ink-mute)' }}>{authBand.l1} → {authBand.l2}</div></div></button>
              <button type="button" className="cr-tile cr-tile-btn" onClick={() => setAuthPick(authPick === 'roi' ? null : 'roi')} title="Expected ROI"><span className="cr-tile-ic"><Icon name="analytics" size={15} /></span>
                <div><div className="cr-tile-v">{roiPct}%</div><div className="cr-tile-k">Expected ROI</div>
                  <div className="cr-tile-cap" style={{ color: roiOk(roiPct) ? 'var(--good-text)' : 'var(--crit-text)' }}>{roiOk(roiPct) ? 'Meets' : 'Below'} {ROI_TARGET_MIN}% target</div></div></button>
              <button type="button" className="cr-tile cr-tile-btn" onClick={() => setAuthPick(authPick === 'contribution' ? null : 'contribution')} title="RCPL contribution gate"><span className="cr-tile-ic"><Icon name="dollar" size={15} /></span>
                <div><div className="cr-tile-v">{contributionPct}%</div><div className="cr-tile-k">RCPL contribution</div>
                  <div className="cr-tile-cap" style={{ color: contributionOk(contributionPct) ? 'var(--good-text)' : 'var(--crit-text)' }}>{contributionOk(contributionPct) ? 'Meets' : 'Below'} ≥{CONTRIBUTION_MIN}% gate</div></div></button>
            </div>
            {authPick && (
              <div className="cr-journey-detail"><Icon name="info" size={13} /> {
                authPick === 'band' ? `Expected monthly turnover ₹${caseTurnover}L falls in the ${authBand.label} band — recommended by ${authBand.recommend}, finalised by ${authBand.finalise}.`
                : authPick === 'chain' ? (authBand.l2 === '—' ? `L1 approval by ${authBand.l1}. No L2 Finance step is required for this band.` : `First L1 approval by ${authBand.l1}, then L2 by ${authBand.l2}.`)
                : authPick === 'roi' ? `Annualised return on the ₹${Math.round(cc.financeSnapshot?.requiredInvestment ?? REQUIRED_INVESTMENT)}L investment ≈ ${roiPct}%. Target is ≥${ROI_TARGET_MIN}% — this ${roiOk(roiPct) ? 'meets' : 'is below'} it.`
                : `RCPL should be ≥${CONTRIBUTION_MIN}% of the DB's overall business; here it is ${contributionPct}% — ${contributionOk(contributionPct) ? 'it meets the gate' : 'below the gate'}.`
              }</div>
            )}
            <p className="cw-auth-note" title="Working-day SLA anchored to Day D — configurable in Admin › SLA"><Icon name="clock" size={12} /> SLA: recommendation + approvals due <b>D{slaCfg.approvalDays > 0 ? `+${slaCfg.approvalDays}` : ''}</b> · IT code by <b>D+{slaCfg.itCodeDays}</b> ({SLA_CONFIG.unit}), anchored to {SLA_CONFIG.anchor}.</p>
          </Card>
          )}

          {/* Finance/Channel Development's own evaluation snapshot — their check, so it's only
              actionable while the case is still with them (stage 'review'); by sign-off it's
              already resolved either way. */}
          {stagePhase === 'review' && (cc.financeSnapshot || cc.channelSnapshot) && (
            <Card title={cc.financeSnapshot ? 'Financial Snapshot' : 'Channel Snapshot'}>
              <div className="cr-tiles cr-tiles-click" role="button" tabIndex={0}
                onClick={() => setConfWhyOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setConfWhyOpen(true) } }}
                title="Click to see how these numbers are calculated">
                {cc.financeSnapshot ? (
                  <>
                    <div className="cr-tile"><span className="cr-tile-ic"><Icon name="documents" size={15} /></span>
                      <div><div className="cr-tile-v">₹{Math.round(cc.financeSnapshot.capitalAvailable)}L</div><div className="cr-tile-k">Capital Available</div><div className="cr-tile-cap" style={{ color: 'var(--ink-mute)' }}>Available funds</div></div></div>
                    <div className="cr-tile"><span className="cr-tile-ic"><Icon name="target" size={15} /></span>
                      <div><div className="cr-tile-v">₹{Math.round(cc.financeSnapshot.requiredInvestment)}L</div><div className="cr-tile-k">Required Investment</div><div className="cr-tile-cap" style={{ color: 'var(--ink-mute)' }}>Investment needed</div></div></div>
                    <div className="cr-tile"><span className="cr-tile-ic"><Icon name="alert" size={15} /></span>
                      <div><div className="cr-tile-v">₹{Math.round(cc.financeSnapshot.fundingGap)}L</div><div className="cr-tile-k">Funding Gap</div><div className="cr-tile-cap" style={{ color: 'var(--ink-mute)' }}>Gap to close</div></div></div>
                    <div className="cr-tile"><span className="cr-tile-ic"><Icon name="analytics" size={15} /></span>
                      <div><div className="cr-tile-v">{cc.financeSnapshot.readinessPct}%</div><div className="cr-tile-k">Financial Readiness Score</div>
                        <div className="cr-tile-cap" style={{ color: cc.financeSnapshot.readinessPct >= 100 ? 'var(--good-text)' : cc.financeSnapshot.readinessPct >= 70 ? 'var(--warn-text)' : 'var(--crit-text)' }}>
                          {cc.financeSnapshot.readinessPct >= 100 ? 'Strong' : cc.financeSnapshot.readinessPct >= 70 ? 'Moderate' : 'Weak'}
                        </div></div></div>
                  </>
                ) : cc.channelSnapshot && (
                  <>
                    <div className="cr-tile"><span className="cr-tile-ic"><Icon name="target" size={15} /></span>
                      <div><div className="cr-tile-v">{cc.channelSnapshot.score.toFixed(1)}/10</div><div className="cr-tile-k">Coverage Score</div></div></div>
                    <div className="cr-tile"><span className="cr-tile-ic"><Icon name="target" size={15} /></span>
                      <div><div className="cr-tile-v">{cc.channelSnapshot.threshold}/10</div><div className="cr-tile-k">Required Threshold</div></div></div>
                    <div className="cr-tile"><span className="cr-tile-ic"><Icon name="alert" size={15} /></span>
                      <div><div className="cr-tile-v">{cc.channelSnapshot.gap.toFixed(1)}/10</div><div className="cr-tile-k">Coverage Gap</div></div></div>
                    <div className="cr-tile"><span className="cr-tile-ic"><Icon name="analytics" size={15} /></span>
                      <div><div className="cr-tile-v">{cc.channelSnapshot.readinessPct}%</div><div className="cr-tile-k">Channel Readiness Score</div></div></div>
                  </>
                )}
              </div>
            </Card>
          )}

          {/* The evaluation recap stays relevant through sign-off (Leadership wants the same
              read), just not once the case is fully closed. */}
          {stagePhase !== 'closed' && insights.length > 0 && (
            <Card title="AI Insights">
              {insights.map((ins) => (
                <div className="cr-insight-row" key={ins.label}>
                  <Icon name={ins.tone === 'good' ? 'check' : ins.tone === 'warn' ? 'alert' : 'close'} size={14} />
                  <span>{ins.label}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Nothing left to follow up on once the case is closed — no more decision to inform. */}
          {stagePhase !== 'closed' && (
          <Card title="Follow up before deciding">
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {viewingAs !== 'ase_asm' && (
                <Button variant="ghost" size="sm" onClick={() => openEmail('asm')}><Icon name="mail" size={13} /> Email ASM</Button>
              )}
              <Button variant="ghost" size="sm" onClick={discuss}><Icon name="comms" size={13} /> {discussLabel}</Button>
              <Button variant="ghost" size="sm" onClick={() => openEmail('distributor')}><Icon name="mail" size={13} /> Email {c.partnerName}</Button>
              <Button variant="ghost" size="sm" onClick={askCopilot}><Icon name="spark" size={13} /> Ask copilot: why flagged?</Button>
            </div>
            {emailSentNote && <p className="muted-note" style={{ marginTop: '0.7rem', marginBottom: 0 }}><Icon name="check" size={12} /> {emailSentNote}</p>}
          </Card>
          )}

          {/* Adding a NEW note only makes sense before sign-off completes; already-sent notes
              stay visible after (a real part of the case's history), just read-only. */}
          {(stagePhase !== 'closed' || !!c.notesForLeadership?.length) && (
          <Card title="Note for Leadership">
            {!!c.notesForLeadership?.length && (
              <div className="cr-panel-attach" style={{ marginBottom: '0.8rem' }}>
                {c.notesForLeadership.map((n, i) => (
                  <div key={i} style={{ padding: '0.5rem 0', borderBottom: i < c.notesForLeadership!.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem' }}>
                      <strong style={{ fontSize: '0.82rem' }}>{n.author}</strong>
                      <span className="muted-note" style={{ margin: 0 }}>{n.when}</span>
                    </div>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>{n.body}</p>
                  </div>
                ))}
              </div>
            )}
            {stagePhase !== 'closed' && !isViewingLive && (
              <p className="muted-note" style={{ margin: 0 }}><Icon name="info" size={12} /> Switch back to the current stage to add a note.</p>
            )}
            {stagePhase !== 'closed' && isViewingLive && (<>
              <p className="muted-note" style={{ marginTop: 0 }}>Add context Leadership should know about this case before it reaches their sign-off.</p>
              <textarea className="input" rows={2} placeholder="e.g. ASM vouches for this distributor despite the shortfall — recommend conditional approval…"
                value={leadershipNote} onChange={(e) => setLeadershipNote(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
                <Button variant="ghost" size="sm" onClick={sendLeadershipNote} disabled={!leadershipNote.trim()}>Send note</Button>
              </div>
              {leadershipSentNote && <p className="muted-note" style={{ margin: 0 }}><Icon name="check" size={12} /> {leadershipSentNote}</p>}
            </>)}
          </Card>
          )}

          {c.subtype === 'replacement' && (
            <div className="gate-callout">
              <span className="flag">Gate</span>
              <p><strong>Replacement DB:</strong> the Distributor Disengagement Recommendation Form for the old DB is required before approval can proceed — filled in by the ASE/ASM at Create Lead time.
                {linked ? (
                  <> ✓ Submitted. <button className="btn ghost sm" style={{ marginLeft: '0.5rem' }} onClick={() => setDiscFormOpen(true)}>View Disengagement Form</button></>
                ) : (
                  <> Not yet submitted — <button className="btn ghost sm" style={{ marginLeft: '0.25rem' }} onClick={() => openEmail('asm')}>Email ASM</button> to have them fill it in from Create Lead / Intake Review.</>
                )}
              </p>
            </div>
          )}

          {linked && (
            <DisengagementFormModal
              open={discFormOpen} onClose={() => setDiscFormOpen(false)}
              readOnly
              existing={c.discontinuationForm}
              onSubmit={() => setDiscFormOpen(false)}
            />
          )}

          {/* Finance's own document gate — only actionable while the case is still with them. */}
          {stagePhase === 'review' && cc.financeSnapshot && (
            <Card title="Financials Verification">
              <p className="muted-note" style={{ marginTop: 0 }}>
                Checked against the distributor's bank statement — the recommendation form's two financial fields, not a generic document stack.
              </p>
              <div className="cr-fin-rows">
                <div className="cr-fin-row"><span>Total Own Funds / Borrowed (₹L)</span><b>{cc.financeSnapshot.ownFunds}</b></div>
                <div className="cr-fin-row"><span>CC Limit (₹L)</span><b>{cc.financeSnapshot.ccLimit}</b></div>
                <div className="cr-fin-row total">
                  <span>Total Available vs Required</span>
                  <b className={cc.financeSnapshot.fundingGap > 0 ? 'crit' : 'good'}>
                    ₹{Math.round(cc.financeSnapshot.capitalAvailable)}L / ₹{Math.round(cc.financeSnapshot.requiredInvestment)}L
                  </b>
                </div>
              </div>

              {(() => {
                const canAct = (viewingAs === 'ase_asm' || canApprove) && isViewingLive
                // Real file if the reviewer actually attached one; the synthetic "mock" PDF
                // (built from the case's own numbers) only ever stands in for seeded/legacy
                // cases that never had a real upload.
                const viewBankStatement = () => {
                  if (bankStatementDoc?.dataUrl) { window.open(bankStatementDoc.dataUrl, '_blank'); return }
                  const b = bankStatementPdf()
                  if (b) openPdfInNewTab(b)
                }
                const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  const reader = new FileReader()
                  reader.onload = () => uploadCaseFinanceDoc(c.code, BANK_STATEMENT_KEY, f.name, typeof reader.result === 'string' ? reader.result : undefined)
                  reader.readAsDataURL(f)
                }
                return (
                  <div style={{ marginTop: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <Icon name={bankStatementDoc ? 'check' : 'documents'} size={14} />
                    <span style={{ fontWeight: 700, color: 'var(--ink)' }}>Bank Statement</span>
                    <Pill tone="crit">Required</Pill>
                    {bankStatementDoc ? (
                      <span className="muted-note" style={{ margin: 0, color: 'var(--good-text)' }}>
                        <Icon name="check" size={12} /> Uploaded: {bankStatementDoc.name}
                        <button className="btn text sm" style={{ marginLeft: '0.4rem', padding: 0 }} onClick={viewBankStatement}>View</button>
                        {canAct && <button className="btn text sm" style={{ marginLeft: '0.4rem', padding: 0 }} onClick={() => bankStatementFileInput.current?.click()}>Replace</button>}
                      </span>
                    ) : (
                      <Button variant="ghost" size="sm" disabled={!canAct} title={!isViewingLive ? 'Switch back to the current stage to upload' : undefined} onClick={() => bankStatementFileInput.current?.click()}>
                        <Icon name="documents" size={13} /> Upload document
                      </Button>
                    )}
                    <input ref={bankStatementFileInput} type="file" style={{ display: 'none' }} onChange={onPickFile} />
                  </div>
                )
              })()}

              {financeGateBlocked
                ? <p className="muted-note" style={{ margin: '0.7rem 0 0', color: 'var(--warn-text)' }}><Icon name="alert" size={12} /> Not yet uploaded — you can still approve, you'll just be asked to confirm.</p>
                : <p className="muted-note" style={{ margin: '0.7rem 0 0', color: 'var(--good-text)' }}><Icon name="check" size={12} /> Bank statement on file.</p>}
            </Card>
          )}

          {/* Reached via "All cases" (see Approvals' rows filter) — resolved cases stay
              browsable forever (even after the candidate becomes an active Partner) so a team
              that was ever involved can always check where it ended up, but the decision itself
              is done — no re-approving/re-rejecting a case that's already closed. */}
          {isResolved && (
            <div className="wizard-foot" style={{ borderTop: 'none', marginTop: 0 }}>
              <span className="muted-note" style={{ margin: 0 }}>
                {parkedOn ? (
                  <><Icon name="clock" size={12} /> Your team's evaluation is cleared — this is <strong>not yet at Leadership</strong>. It's still waiting on{' '}
                    <strong>{REVIEW_TEAM_LABEL[parkedOn.ownerRole] ?? parkedOn.ownerRole}</strong> ({parkedOn.code}) to clear their own check before it routes up.</>
                ) : (
                  <><Icon name={c.status === 'approved' ? 'check' : 'close'} size={12} /> This case is <strong>{STATUS_LABEL[c.status]}</strong> — no further action is possible on it.</>
                )}
              </span>
            </div>
          )}

        </div>

        <div className="cr-panel">
          {canApprove && !isResolved && !isViewingLive && (
            <Card title="Your action">
              <p className="muted-note" style={{ margin: 0 }}><Icon name="info" size={12} /> You're previewing <b>{stateLabel(effectiveViewState)}</b> — switch back to the current stage to approve, reject, or request info.</p>
            </Card>
          )}
          {canApprove && !isResolved && isViewingLive && (
            <Card title="Your action">
              <p className="muted-note" style={{ marginTop: 0 }}>Review the details and take the appropriate action.</p>
              <ul className="cr-conditions" style={{ marginBottom: '0.9rem' }}>
                {conditions.map((cond) => <li key={cond}>{cond}</li>)}
              </ul>
              <div className="cr-action-row cr-action-row-stack">
                <div className="cr-approve-row">
                  <Button disabled={blocked} onClick={() => requestApprove('conditions')} style={{ flex: 1 }}
                    title={blocked ? 'Link the Discontinuation Form first' : undefined}>
                    {isFinalOnboardingApproval ? 'Complete Onboarding' : hasConditions ? 'Approve with Conditions' : 'Approve'} →
                  </Button>
                  {hasConditions && (
                    <>
                      <Button disabled={blocked} onClick={() => setApproveMenuOpen((v) => !v)} title="More approve options">
                        <Icon name="chevronDown" size={14} />
                      </Button>
                      {approveMenuOpen && (
                        <div className="cr-approve-menu">
                          <button className="btn ghost sm" onClick={() => { setApproveMenuOpen(false); requestApprove('plain') }}>Approve without conditions →</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <Button variant="ghost" style={{ color: 'var(--crit-text)' }} onClick={() => onDecide(c.code, 'rejected')}><Icon name="close" size={13} /> Reject</Button>
                <Button variant="ghost" onClick={() => onDecide(c.code, 'info_requested')}><Icon name="comms" size={13} /> Request More Info</Button>
                {c.ownerRole === 'channel_dev' && (
                  <Button variant="ghost" onClick={() => onDecide(c.code, 'sent_back')} title="Hand this case back to the ASE/ASM to fix and resubmit — not a rejection.">
                    <Icon name="back" size={13} /> Send Back to ASM
                  </Button>
                )}
              </div>
              <p className="muted-note" style={{ margin: '0.7rem 0 0', textAlign: 'center' }}><Icon name="shield" size={11} /> Your decision will be recorded in the audit log.</p>
            </Card>
          )}

          {(auditTrail.length > 0 || thread) && (
            <Card title="Case History &amp; Notes">
              <p className="muted-note" style={{ marginTop: 0 }}>
                {c.ownerRole === 'leadership'
                  ? 'Everything logged so far — chat with the ASM/distributor and every prior action.'
                  : 'Chat and audit trail logged on this case so far.'}
              </p>
              {thread && thread.participants.length > 0 && (
                <div className="cr-hist-chat">
                  {thread.participants.map((m) => (
                    <div className="cr-hist-chat-row" key={m.id}>
                      <span className="cr-hist-chat-author">{m.authorName} <span className="cr-hist-chat-role">({ROLE_BY_CODE[m.authorRole]?.label ?? m.authorRole})</span></span>
                      <span className="cr-hist-chat-body">{m.body}</span>
                    </div>
                  ))}
                </div>
              )}
              {auditTrail.length > 0 && (
                <div className="cr-hist-timeline">
                  {auditTrail.map((a, i) => (
                    <div className="cr-hist-item" key={i}>
                      <span className={`cr-hist-dot tone-${a.tone}`} />
                      <div className="cr-hist-body">
                        <div className="cr-hist-row"><span className="cr-hist-title">{a.title}</span><span className="cr-hist-when">{a.when}</span></div>
                        <div className="cr-hist-by">{a.by}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {keyDocuments.length > 0 && (
            <Card>
              <div className="row-between" style={{ marginBottom: '0.7rem' }}>
                <span className="cr-panel-h" style={{ margin: 0 }}>Key Documents ({keyDocuments.length})</span>
              </div>
              <div className="cr-panel-attach">
                {keyDocuments.map((d) => (
                  <div className="cr-attach-row" key={d.key}>
                    <span><Icon name="documents" size={13} /> {d.name}{d.sub && <span className="cell-sub"> · {d.sub}</span>}</span>
                    <button className="btn text sm" style={{ padding: 0 }} onClick={d.view}>View</button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Approval Journey">
            <div className="cr-journey cr-journey-side">
              {journey.map((s) => (
                <button type="button" className={`cr-step ${s.state} ${journeyPick === s.label ? 'picked' : ''}`} key={s.label}
                  onClick={() => setJourneyPick(journeyPick === s.label ? null : s.label)} title={s.desc}>
                  <span className="cr-step-marker">{s.state === 'done' ? <Icon name="check" size={14} /> : s.state === 'current' ? <Icon name="clock" size={13} /> : <Icon name="user" size={13} />}</span>
                  <span className="cr-step-label">{s.label}</span>
                  <span className="cr-step-cap">{JOURNEY_CAPTION[s.state]}</span>
                </button>
              ))}
            </div>
            {journeyPick && (() => {
              const st = journey.find((j) => j.label === journeyPick)
              return st ? (
                <div className="cr-journey-detail">
                  <Icon name="info" size={13} />
                  <div>
                    <div className="cr-journey-detail-title"><b>{st.label}</b> — {JOURNEY_CAPTION[st.state]}</div>
                    <div>{st.desc}</div>
                  </div>
                </div>
              ) : null
            })()}
          </Card>

          <button className="cr-hero-toggle" onClick={askCopilot}>✦ Ask Copilot: Why this recommendation? →</button>
        </div>
      </div>

      <Modal open={!!confirmNoDocKind} onClose={() => setConfirmNoDocKind(null)} title="Continue without the bank statement?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--ink)' }}>
            {c.partnerName}'s bank statement hasn't been uploaded yet. Are you ready to continue without it?
          </p>
          <p className="muted-note" style={{ margin: 0 }}>
            You can add a Note for Leadership above explaining why, then approve anyway — this will be recorded in the audit log.
          </p>
          <div className="row-between" style={{ marginTop: '0.4rem' }}>
            <Button variant="ghost" onClick={() => setConfirmNoDocKind(null)}>Cancel</Button>
            <Button onClick={confirmApproveWithoutDoc}>Yes, continue anyway →</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!emailTarget} onClose={() => { setEmailTarget(null); setCompletingOnboarding(false) }}
        title={completingOnboarding ? `Complete Onboarding — ${emailRecipientName}` : `Email ${emailRecipientName}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="field">
            <label>To</label>
            <input className="input" value={emailTo} disabled />
          </div>
          <div className="field">
            <label>Subject</label>
            <input className="input" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
          </div>
          <div className="field">
            <label>Message</label>
            <textarea className="input" rows={8} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          {sendEmailError && (
            <p className="muted-note" style={{ margin: 0, color: 'var(--crit-text)' }}>
              <Icon name="alert" size={12} /> Couldn't send: {sendEmailError}
            </p>
          )}
          <div className="row-between" style={{ marginTop: '0.5rem' }}>
            <Button variant="ghost" onClick={() => { setEmailTarget(null); setCompletingOnboarding(false) }} disabled={sendingEmail}>Cancel</Button>
            <Button onClick={sendEmail} disabled={sendingEmail}>
              <Icon name="mail" size={13} /> {sendingEmail ? 'Sending…' : completingOnboarding ? 'Complete Onboarding →' : 'Send email'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}


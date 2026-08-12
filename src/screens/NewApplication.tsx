import './NewApplication.css'
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, Modal, Pill, Toggle } from '../components/ui'
import { AgentTrace } from '../components/ui/AgentTrace'
import type { TraceLine } from '../components/ui/AgentTrace'
import { Icon } from '../components/ui/icons'
import { useApp, nextCaseCode, slaLabelFromHours } from '../store'
import { PARTNER_TYPES, WIZARD_BUILT } from '../mock/templates'
import {
  DB_TYPES, DEFAULT_INFRA,
  EXPECTED_RCPL_TURNOVER, FIN_EVAL_PASS, INFRA_FACTORS, INFRA_THRESHOLD, WORKING_CAPITAL_DAYS,
  REQUIRED_INVESTMENT, approvalAuthority, meanInfra, requiredInvestmentFor, round1,
} from '../mock/onboarding'
import type { DbCategory, InfraState } from '../mock/onboarding'
import { CANDIDATE_STAGES, IDEAL_DB, DIRECTORY_LEADS } from '../mock/candidates'
import {
  BASIC_INFORMATION, BACKGROUND_INFORMATION, COVERAGE_DATA, FINANCIAL_BREAKDOWN, TOTAL_INVESTMENT_REQUIRED,
} from '../mock/recommendationForm'
import type { ApplicationSubtype, CandidateCard, CandidateStage, CaseRecord, PartnerTypeCode, RoleCode } from '../types'
import { EXTRACTIONS, mergedFields, REQUIRED_DOCS } from '../mock/intake'
import { buildPdf, openPdfInNewTab } from '../lib/pdf'
import type { Extraction } from '../mock/intake'
import { DEMO_USERS, ROLE_BY_CODE } from '../mock/roles'
import { DisengagementFormModal } from '../components/DisengagementForm'
import { CONTRIBUTION_MIN, contributionPctFor } from '../lib/roi'

// The Intake and Recommend wizard steps were folded away — that content (the recommendation
// form fields, the AI outcome prediction, the accept/override choice) now lives entirely in
// the Leads step's "View details" popup, so Leads goes straight to Evaluate.
type Step = 'type' | 'candidates' | 'evaluate' | 'finance-review' | 'channel-review' | 'agreement' | 'success'

// A candidate's pipeline stage is an outcome of the wizard steps it has actually cleared —
// never something set by hand. Entering one of these steps advances the stage; navigating
// back does not regress it, since real approval status doesn't un-happen.
// Entering 'success' no longer activates the candidate itself — Leadership's own final
// sign-off in Approvals is what does that now (see AgreementStep's sendToLeadership and
// decideCase's becomesActive in store.ts), so there's no 'active' mapping here anymore.
const STAGE_ON_ENTER: Partial<Record<Step, CandidateStage>> = {
  evaluate: 'pending',
  'finance-review': 'approval_1', 'channel-review': 'approval_2',
  agreement: 'approval_2',
}
const MAIN_STEPS: { id: Step; label: string }[] = [
  { id: 'type', label: 'Type' }, { id: 'candidates', label: 'Leads' },
  { id: 'evaluate', label: 'Evaluate' }, { id: 'finance-review', label: 'Review' }, { id: 'agreement', label: 'Agreement' },
]
const PT_COLOR: Record<PartnerTypeCode, string> = {
  distributor: 'var(--p-finance)', vendor: 'var(--p-mdm)', logistics: 'var(--p-channel)', copacker: 'var(--p-ase)',
}

// The "+ Add" picker draws from the Partner directory (via DIRECTORY_LEADS) so the leads you
// can add are the same partners shown in the Partners directory.
const LEAD_CANDIDATES: CandidateCard[] = DIRECTORY_LEADS

export function NewApplication() {
  const scenario = useApp((s) => s.scenario)
  const location = useLocation()
  // A lead created from the Intake Inbox already implies a partner type (its documents/fields
  // are shaped for one) — skip straight past the Type step instead of asking the user to redo it.
  // Only skip when that type's wizard actually exists; otherwise land on Type with it pre-selected
  // so the "Phase 2" gate explains why (rather than dropping into the distributor-shaped flow).
  const initNav = location.state as { partnerType?: PartnerTypeCode; intakeLead?: CandidateCard } | null
  const skipType = initNav?.partnerType
  const skipBuilt = skipType ? WIZARD_BUILT[skipType] : false
  // When the field team's shortlist is already waiting (Trade Marketing arriving from the
  // "Lead shortlisted" notification or the sidebar), skip Type and open on the comparison.
  const shortlistWaiting = useApp.getState().evalIds.length > 0
  const [step, setStep] = useState<Step>(skipBuilt || shortlistWaiting ? 'candidates' : 'type')
  const [partnerType, setPartnerType] = useState<PartnerTypeCode | null>(skipType ?? (shortlistWaiting ? 'distributor' : null))

  // Scoring + candidate pipeline live in the shared store — same data as the Candidate Pipeline screen.
  const infra = useApp((s) => s.infra)
  const setInfra = useApp((s) => s.setInfra)
  const ownFunds = useApp((s) => s.ownFunds)
  const setOwnFunds = useApp((s) => s.setOwnFunds)
  const ccLimit = useApp((s) => s.ccLimit)
  const setCcLimit = useApp((s) => s.setCcLimit)
  const candidates = useApp((s) => s.candidates)
  const selectedId = useApp((s) => s.selectedCandidateId)
  const selected = candidates.find((c) => c.id === selectedId) ?? candidates[0]
  const moveCandidate = useApp((s) => s.moveCandidate)
  const updateCandidateEvaluation = useApp((s) => s.updateCandidateEvaluation)
  const setSelectedId = useApp((s) => s.setSelectedCandidateId)
  const removeCandidate = useApp((s) => s.removeCandidate)
  const rejectCandidate = useApp((s) => s.rejectCandidate)
  const flagCandidateCase = useApp((s) => s.flagCandidateCase)
  const flaggedCases = useApp((s) => s.flaggedCases)
  const pushNotification = useApp((s) => s.pushNotification)
  const logAudit = useApp((s) => s.logAudit)
  const slaHours = useApp((s) => s.slaHours)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  // Per the SOP the ASE/ASM only SUBMITS the recommendation — the system auto-evaluates and the
  // failed dimension(s) route to Finance / Trade Marketing, who review from Approvals. So a
  // non-admin running this wizard stops at a "submitted" screen instead of walking into the
  // reviewer-only Finance/Channel steps. Admin keeps the full end-to-end flow for demos.
  const submitOnly = viewingAs !== 'admin'

  // Candidates chosen for batch evaluation. The Evaluation Agent scores each ticked lead
  // and compares the forks; the user then proceeds with one. Nothing is ticked by default —
  // the user picks which leads to evaluate (tick at least one to continue). The shortlist lives
  // in the shared store so the same set is visible across personas (ASE/ASM ↔ Channel Development).
  const evalIds = useApp((s) => s.evalIds)
  const toggleEval = useApp((s) => s.toggleEvalId)
  const shortlistCandidate = useApp((s) => s.shortlistCandidate)
  // Never leave the "proceed" candidate outside the evaluation set. Reload that candidate's OWN
  // stored scores onto the sliders too — otherwise whichever candidate was active before keeps
  // "owning" the live infra/finance sliders, misattributed to whoever becomes selected next.
  useEffect(() => {
    if (evalIds.length && !evalIds.includes(selectedId)) {
      const next = candidates.find((c) => c.id === evalIds[0])
      if (next) loadCandidateScores(next)
      setSelectedId(evalIds[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalIds, selectedId, setSelectedId])

  // Arrived from an Intake item → drop that lead into the pipeline, select & tick it, and open
  // on the Leads step, so the wizard reflects the reviewed lead rather than a pre-seeded one.
  useEffect(() => {
    const lead = initNav?.intakeLead
    if (lead && WIZARD_BUILT[initNav?.partnerType ?? 'distributor']) {
      shortlistCandidate(lead)
      setStep('candidates')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Add a lead from the Leads pool into the pipeline (and tick it for evaluation); remove one out.
  const addLead = (c: CandidateCard) => shortlistCandidate(c)
  // removeCandidate also drops the id from the shared shortlist.
  const removeLead = (id: string) => removeCandidate(id)

  // Forward navigation advances the selected candidate's stage to match; backward navigation
  // (sidenav clicks, "Back" buttons) never regresses it — status only moves forward with progress.
  const goToStep = (next: Step) => {
    const stage = STAGE_ON_ENTER[next]
    if (stage) moveCandidate(selectedId, stage)
    // Entering finance/channel review means the candidate was actually flagged — raise a real
    // case in the shared Approvals queue so the owning team (Finance / Channel Development) can
    // see and act on it there, instead of the review living only inside this wizard session.
    // A candidate can fail BOTH checks — raise a case for EVERY team that's failing right now,
    // not just whichever one `next` happens to point at, so Channel Development still gets its
    // own case (and its own turn) even when Finance is the one currently blocking the wizard's
    // linear step order. decideCase's siblingStillOpen check in store.ts depends on both
    // sibling cases actually existing — without this, a dual-fail candidate only ever got one
    // case, and clearing it skipped straight to Leadership instead of also routing to the
    // other team.
    if ((next === 'finance-review' || next === 'channel-review') && selected) {
      const infraTotalVal = meanInfra(infra)
      const finEvalVal = Math.round(((ownFunds + ccLimit) / requiredInvestment) * 100)
      const codesSoFar = [...flaggedCases]
      const raiseCase = (finance: boolean) => {
        const teamLabel = finance ? 'Finance' : 'Trade Marketing'
        // Re-entering this step for a candidate already raised (e.g. navigating back and
        // forward through the wizard) must update that same team's case, not mint a fresh
        // code that'd just raise a duplicate — see flagCandidateCase's candidateId+ownerRole
        // upsert in store.ts.
        const existingCase = flaggedCases.find((c) => c.candidateId === selected.id && c.ownerRole === (finance ? 'finance' : 'channel_dev'))
        const caseCode = existingCase?.code ?? nextCaseCode(codesSoFar, partnerType ?? 'distributor')
        codesSoFar.push({ code: caseCode } as CaseRecord)
        const flagDetail = finance
          ? `CC limit + own funds (₹${ownFunds + ccLimit}L) are ${FIN_EVAL_PASS - finEvalVal}% below the ₹${requiredInvestment}L required investment (Financial Evaluation ${finEvalVal}% vs ${FIN_EVAL_PASS}% required).`
          : (infraTotalVal < INFRA_THRESHOLD
              ? `Channel Management Evaluation score (${infraTotalVal.toFixed(1)}/10) is below the ${INFRA_THRESHOLD} threshold.`
              : `RCPL contribution to overall business (${contributionPct}%) is below the ${CONTRIBUTION_MIN}% Channel Management Evaluation gate.`)
        flagCandidateCase({
          code: caseCode,
          partnerName: selected.name,
          partnerType: partnerType ?? 'distributor',
          town: selected.town,
          state: 'MH',
          subtype: selected.subtype ?? 'new',
          status: 'flagged',
          ownerRole: finance ? 'finance' : 'channel_dev',
          slaLabel: slaLabelFromHours(slaHours),
          isOverdue: false,
          // Replacement DBs start ungated only once the Discontinuation Form is linked (see
          // Approvals' hard gate) — already true if it was filled in up front at Create Lead
          // time, or preserved if it was already linked on a re-raise, rather than resetting it.
          hasDiscontinuationForm: selected.subtype !== 'replacement' || !!selected.discontinuationForm || (existingCase?.hasDiscontinuationForm ?? false),
          discontinuationForm: selected.discontinuationForm ?? existingCase?.discontinuationForm,
          // confidencePct here means "likelihood to auto-clear" (see confidenceTone's doc comment
          // in Approvals.tsx) — the candidate's own pre-evaluation ranking score is a different
          // number entirely, and showing it next to a real shortfall reads as "100% confident"
          // on a case that just got flagged for falling short.
          confidencePct: finance ? finEvalVal : Math.round((infraTotalVal / INFRA_THRESHOLD) * 100),
          candidateId: selected.id,
          expectedTurnover: selected.expectedRcplTurnover,
          flagDetail,
          signoffAuthority: authority as 'SM' | 'RBL',
          ...(finance
            ? { financeSnapshot: { ownFunds, ccLimit, capitalAvailable: ownFunds + ccLimit, requiredInvestment, fundingGap: round1(Math.max(0, requiredInvestment - (ownFunds + ccLimit))), readinessPct: finEvalVal } }
            : { channelSnapshot: { score: infraTotalVal, threshold: INFRA_THRESHOLD, gap: Math.max(0, INFRA_THRESHOLD - infraTotalVal), readinessPct: Math.round((infraTotalVal / INFRA_THRESHOLD) * 100) } }),
        })
        // Notify the owning team and log the routing decision to the audit trail.
        pushNotification({
          title: `${caseCode} routed to ${teamLabel}`,
          body: `${selected.name} (${selected.town}) — ${flagDetail}`,
          href: '/approvals',
          forRole: finance ? 'finance' : 'channel_dev',
        })
        logAudit({ actor: 'Evaluation Agent', kind: 'ai', action: `Flagged & routed to ${teamLabel}`, entity: caseCode })
      }
      if (!financePass) raiseCase(true)
      if (!channelPass) raiseCase(false)
    }
    setStep(next)
  }

  // The Scenario toggle presets the numbers so the demo cleanly auto-clears or flags.
  useEffect(() => {
    if (scenario === 'flagged') {
      setInfra({ salesmen: 6, delivery: 6, godown: 6, computer: 7, reputation: 6, coverage: 6, credit: 7, involvement: 6 })
      setOwnFunds(90); setCcLimit(40) // (90+40)/144.6 = 90% ⇒ Financial Evaluation fails
    } else {
      setInfra({ ...DEFAULT_INFRA }); setOwnFunds(120); setCcLimit(80) // 138% + infra 8 ⇒ auto-clear
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario])

  const infraTotal = meanInfra(infra)
  // Required investment is this candidate's OWN working-capital need, not a flat figure shared
  // by every DB (workbook formula — see requiredInvestmentFor's doc comment).
  const requiredInvestment = selected ? requiredInvestmentFor(selected.turnoverMonthly, selected.expectedRcplTurnover) : REQUIRED_INVESTMENT
  const finEval = Math.round(((ownFunds + ccLimit) / requiredInvestment) * 100)
  const financePass = finEval >= FIN_EVAL_PASS // Financial Evaluation ≥ 100% (workbook logic)
  // Channel Management Evaluation (workbook: =IF(AND(contribution%>=20%, infra>=7),1,0)) —
  // needs BOTH the infra bar AND RCPL's minimum share of the DB's overall business, not infra alone.
  const contributionPct = selected ? contributionPctFor(selected.turnoverMonthly, selected.expectedRcplTurnover) : 0
  const channelPass = infraTotal >= INFRA_THRESHOLD && contributionPct >= CONTRIBUTION_MIN
  const authority = approvalAuthority(EXPECTED_RCPL_TURNOVER) // >₹50L ⇒ RBL, else SM
  // Carried from the Create Lead / intake form's subtype selection (defaults to 'new' when
  // absent — e.g. seeded/directory leads that predate this field).
  const isReplacement = selected?.subtype === 'replacement'
  const stepIndex = MAIN_STEPS.findIndex((f) => f.id === step) === -1
    ? (step === 'channel-review' ? 3 : 0)
    : MAIN_STEPS.findIndex((f) => f.id === step)

  // Batch-proceed with all checked leads. Each lead is routed independently —
  // cases are created for those that fail Finance or Channel; those that auto-clear
  // are moved straight to active. The wizard then navigates to the most complex
  // next step across the batch so the user can review/approve from there.
  const [batchChosen, setBatchChosen] = useState<Evaluated[]>([])
  const goAfterEvaluate = (chosenList: Evaluated[]) => {
    if (!chosenList.length) return
    setBatchChosen(chosenList)
    // Process every checked lead — flag/route each one. Track codes generated so far in this
    // batch so two leads flagged in the same pass never collide on the same case number.
    const codesSoFar = [...flaggedCases]
    chosenList.forEach((chosen) => {
      // A candidate can fail BOTH checks — raise a case for EVERY team that's failing, not
      // just one, same reasoning as the single-candidate flow above (decideCase's
      // siblingStillOpen in store.ts needs both sibling cases to actually exist).
      const raiseCase = (finance: boolean) => {
        const teamLabel = finance ? 'Finance' : 'Trade Marketing'
        // Each lead's own required investment — not a flat figure shared across the batch.
        const chosenRequiredInvestment = requiredInvestmentFor(chosen.c.turnoverMonthly, chosen.c.expectedRcplTurnover)
        // Same candidateId+ownerRole reuse as the single-candidate flow above — re-running the
        // batch for a lead already flagged must update that team's case, not raise a duplicate.
        const existingCase = flaggedCases.find((c) => c.candidateId === chosen.c.id && c.ownerRole === (finance ? 'finance' : 'channel_dev'))
        const caseCode = existingCase?.code ?? nextCaseCode(codesSoFar, partnerType ?? 'distributor')
        codesSoFar.push({ code: caseCode } as CaseRecord)
        const chosenContributionPct = contributionPctFor(chosen.c.turnoverMonthly, chosen.c.expectedRcplTurnover)
        const flagDetail = finance
          ? `CC limit + own funds are ${FIN_EVAL_PASS - chosen.fin}% below the ₹${chosenRequiredInvestment}L required investment (Financial Evaluation ${chosen.fin}% vs ${FIN_EVAL_PASS}% required).`
          : (chosen.infra < INFRA_THRESHOLD
              ? `Channel Management Evaluation score (${chosen.infra.toFixed(1)}/10) is below the ${INFRA_THRESHOLD} threshold.`
              : `RCPL contribution to overall business (${chosenContributionPct}%) is below the ${CONTRIBUTION_MIN}% Channel Management Evaluation gate.`)
        flagCandidateCase({
          code: caseCode,
          partnerName: chosen.c.name,
          partnerType: partnerType ?? 'distributor',
          town: chosen.c.town,
          state: 'MH',
          subtype: chosen.c.subtype ?? 'new',
          status: 'flagged',
          ownerRole: finance ? 'finance' : 'channel_dev',
          slaLabel: slaLabelFromHours(slaHours),
          isOverdue: false,
          // Replacement DBs start ungated only once the Discontinuation Form is linked (see
          // Approvals' hard gate) — already true if it was filled in up front at Create Lead
          // time, or preserved if it was already linked on a re-raise, rather than resetting it.
          hasDiscontinuationForm: chosen.c.subtype !== 'replacement' || !!chosen.c.discontinuationForm || (existingCase?.hasDiscontinuationForm ?? false),
          discontinuationForm: chosen.c.discontinuationForm ?? existingCase?.discontinuationForm,
          // Same fix as the single-candidate flow above — confidencePct means "likelihood to
          // auto-clear," not the candidate's unrelated pre-evaluation ranking score.
          confidencePct: finance ? chosen.fin : Math.round((chosen.infra / INFRA_THRESHOLD) * 100),
          candidateId: chosen.c.id,
          expectedTurnover: chosen.c.expectedRcplTurnover,
          flagDetail,
          signoffAuthority: authority as 'SM' | 'RBL',
          ...(finance
            ? (() => {
              // Batch evaluation only scores an aggregate financial %, not this candidate's own
              // individual Own Funds / CC Limit sliders (those only exist for the one candidate
              // being actively compared) — split the resulting capital 65/35 as a reasonable
              // own-funds-led mix, consistent with the live single-candidate flow above.
              const capitalAvailable = Math.round((chosen.fin / 100) * chosenRequiredInvestment)
              const ownFundsSplit = Math.round(capitalAvailable * 0.65)
              return { financeSnapshot: { ownFunds: ownFundsSplit, ccLimit: capitalAvailable - ownFundsSplit, capitalAvailable, requiredInvestment: chosenRequiredInvestment, fundingGap: round1(Math.max(0, chosenRequiredInvestment - capitalAvailable)), readinessPct: chosen.fin } }
            })()
            : { channelSnapshot: { score: chosen.infra, threshold: INFRA_THRESHOLD, gap: Math.max(0, INFRA_THRESHOLD - chosen.infra), readinessPct: Math.round((chosen.infra / INFRA_THRESHOLD) * 100) } }),
        })
        pushNotification({
          title: `${caseCode} routed to ${teamLabel}`,
          body: `${chosen.c.name} (${chosen.c.town}) — ${flagDetail}`,
          href: '/approvals',
          forRole: finance ? 'finance' : 'channel_dev',
        })
        logAudit({ actor: 'Evaluation Agent', kind: 'ai', action: `Flagged & routed to ${teamLabel}`, entity: caseCode })
      }
      // A Replacement DB is a compliance gate, not a performance one — even a candidate that
      // clears both Financial and Channel Management Evaluation still can't go active until the
      // old DB's Discontinuation Form is linked, so it always gets a case raised for Channel
      // Development — even when the form was already filled in at Create Lead time, so they
      // still get real visibility into the swap (who/what/why) instead of it silently activating
      // with no record anyone on that team ever saw.
      const needsDiscontinuation = chosen.c.subtype === 'replacement' && !chosen.c.discontinuationForm
      const raiseDiscontinuationCase = () => {
        const existingCase = flaggedCases.find((c) => c.candidateId === chosen.c.id && c.ownerRole === 'channel_dev')
        if (existingCase?.hasDiscontinuationForm) return
        const caseCode = existingCase?.code ?? nextCaseCode(codesSoFar, partnerType ?? 'distributor')
        codesSoFar.push({ code: caseCode } as CaseRecord)
        const oldDbLabel = chosen.c.oldDbCode ? ` for ${chosen.c.oldDbCode}${chosen.c.oldDbName ? ` (${chosen.c.oldDbName})` : ''}` : ''
        const flagDetail = needsDiscontinuation
          ? `Replacement DB${oldDbLabel} — the Discontinuation Form for the old DB must be linked before this can be approved.`
          : `Replacement DB${oldDbLabel} — Disengagement Form already filled in at Create Lead time; shared here for visibility, no action needed.`
        flagCandidateCase({
          code: caseCode,
          partnerName: chosen.c.name,
          partnerType: partnerType ?? 'distributor',
          town: chosen.c.town,
          state: 'MH',
          subtype: 'replacement',
          status: needsDiscontinuation ? 'flagged' : 'approved',
          ownerRole: 'channel_dev',
          slaLabel: slaLabelFromHours(slaHours),
          isOverdue: false,
          hasDiscontinuationForm: !needsDiscontinuation,
          discontinuationForm: chosen.c.discontinuationForm,
          confidencePct: chosen.c.confidencePct,
          candidateId: chosen.c.id,
          expectedTurnover: chosen.c.expectedRcplTurnover,
          flagDetail,
          signoffAuthority: authority as 'SM' | 'RBL',
        })
        pushNotification({
          title: needsDiscontinuation ? `${caseCode} routed to Trade Marketing` : `${caseCode} — Replacement DB, for your visibility`,
          body: `${chosen.c.name} (${chosen.c.town}) — ${flagDetail}`,
          href: '/approvals',
          forRole: 'channel_dev',
        })
        logAudit({
          actor: 'Evaluation Agent', kind: 'ai',
          action: needsDiscontinuation ? 'Flagged & routed to Trade Marketing — Discontinuation Form required' : 'Shared Disengagement Form with Trade Marketing for visibility',
          entity: caseCode,
        })
      }
      // No issues → both evaluations cleared. Still sits with Channel Development for a real
      // approval — clean doesn't mean unreviewed — but clearing it activates straight to IT for
      // the DB Code, no separate Leadership sign-off on top (see decideCase's cleanFastTrack).
      const routeCleanCaseToChannelDev = () => {
        const existingCase = flaggedCases.find((c) => c.candidateId === chosen.c.id && c.ownerRole === 'channel_dev')
        const caseCode = existingCase?.code ?? nextCaseCode(codesSoFar, partnerType ?? 'distributor')
        codesSoFar.push({ code: caseCode } as CaseRecord)
        const flagDetail = 'Financial & Channel Management Evaluation both cleared — no issues. Sent to Channel Development for approval before DB Code creation.'
        flagCandidateCase({
          code: caseCode,
          partnerName: chosen.c.name,
          partnerType: partnerType ?? 'distributor',
          town: chosen.c.town,
          state: 'MH',
          subtype: chosen.c.subtype ?? 'new',
          status: 'flagged',
          ownerRole: 'channel_dev',
          autoCleared: true,
          slaLabel: slaLabelFromHours(slaHours),
          isOverdue: false,
          hasDiscontinuationForm: chosen.c.subtype !== 'replacement' || !!chosen.c.discontinuationForm || (existingCase?.hasDiscontinuationForm ?? false),
          discontinuationForm: chosen.c.discontinuationForm ?? existingCase?.discontinuationForm,
          confidencePct: existingCase?.confidencePct ?? 96,
          candidateId: chosen.c.id,
          expectedTurnover: chosen.c.expectedRcplTurnover,
          flagDetail,
          signoffAuthority: authority as 'SM' | 'RBL',
        })
        pushNotification({
          title: `${caseCode} — clean case, awaiting Channel Dev approval`,
          body: `${chosen.c.name} (${chosen.c.town}) — ${flagDetail}`,
          href: '/approvals',
          forRole: 'channel_dev',
        })
        logAudit({ actor: 'Evaluation Agent', kind: 'ai', action: 'Auto-cleared — sent to Channel Development for approval', entity: caseCode })
        moveCandidate(chosen.c.id, 'approval_1')
      }
      if (!chosen.financePass) raiseCase(true)
      if (!chosen.channelPass) raiseCase(false)
      if (chosen.financePass && chosen.channelPass) {
        if (chosen.c.subtype === 'replacement') raiseDiscontinuationCase()
        if (needsDiscontinuation) {
          moveCandidate(chosen.c.id, 'approval_1')
        } else {
          routeCleanCaseToChannelDev()
        }
      } else {
        moveCandidate(chosen.c.id, 'approval_1')
      }
    })
    // Sync sliders to the primary lead (first checked that needs most review, or first that clears).
    const primary = chosenList.find((e) => !e.financePass) ?? chosenList.find((e) => !e.channelPass) ?? chosenList[0]
    loadCandidateScores(primary.c)
    setSelectedId(primary.c.id)
    // Navigate to the most complex step across the batch.
    const anyFinance = chosenList.some((e) => !e.financePass)
    const anyChannel = chosenList.some((e) => !e.channelPass)
    const anyReplacementNeedsDiscontinuation = chosenList.some((e) => e.c.subtype === 'replacement' && !e.c.discontinuationForm)
    // The ASE/ASM's job ends at submission — the cases above are already raised & routed, so a
    // non-admin lands on the "submitted" screen instead of the reviewer-only steps.
    const next: Step = submitOnly ? 'success'
      : anyFinance ? 'finance-review' : (anyChannel || anyReplacementNeedsDiscontinuation) ? 'channel-review' : 'agreement'
    setStep(next)
  }
  const afterFinance = (): Step => (!channelPass ? 'channel-review' : 'agreement')
  const goAfterFinance = () => goToStep(afterFinance())

  // Per-candidate evaluation. The selected candidate reflects the live sliders (and the
  // scenario toggle); the others use their own stored scores. This is what the Evaluate
  // step compares across the batch.
  // A candidate that's already been activated has a real Partner record — it belongs only in
  // the Partners directory from here on. One that's been routed to Finance/Channel review
  // (approval_1/approval_2) is now Approvals' to work, not New Application's — it stays out of
  // the Leads/Evaluate pipeline view here until it comes back active or gets rejected.
  const pipelineCandidates = useMemo(
    () => candidates.filter((c) => c.stage !== 'active' && c.stage !== 'approval_1' && c.stage !== 'approval_2'),
    [candidates])
  const evaluated = useMemo(() =>
    pipelineCandidates.filter((c) => evalIds.includes(c.id)).map((c) => {
      const fin = c.id === selectedId ? finEval : c.finEvalPct
      const infra = c.id === selectedId ? infraTotal : c.infraScore
      const contribution = contributionPctFor(c.turnoverMonthly, c.expectedRcplTurnover)
      return { c, fin, infra, financePass: fin >= FIN_EVAL_PASS, channelPass: infra >= INFRA_THRESHOLD && contribution >= CONTRIBUTION_MIN }
    }),
    [pipelineCandidates, evalIds, selectedId, finEval, infraTotal])

  // Reproduce a candidate's stored score on the live sliders, so proceeding with it keeps
  // the downstream review/routing consistent with what the comparison showed. Uses the
  // candidate's own REAL per-factor scores and Own Funds/CC Limit when it has them (i.e. it was
  // ever actually edited/saved here before); older/seeded candidates that predate those fields
  // fall back to a flat reconstruction from just their average infraScore/finEvalPct.
  const loadCandidateScores = (c: CandidateCard) => {
    if (c.infraFactors) {
      setInfra(c.infraFactors)
    } else {
      const v = Math.max(1, Math.min(10, Math.round(c.infraScore)))
      setInfra({ salesmen: v, delivery: v, godown: v, computer: v, reputation: v, coverage: v, credit: v, involvement: v })
    }
    if (c.ownFunds != null && c.ccLimit != null) {
      setOwnFunds(c.ownFunds)
      setCcLimit(c.ccLimit)
    } else {
      const total = Math.round((c.finEvalPct / 100) * requiredInvestmentFor(c.turnoverMonthly, c.expectedRcplTurnover))
      const own = Math.min(200, Math.max(0, Math.round(total * 0.6)))
      setOwnFunds(own)
      setCcLimit(Math.min(150, Math.max(0, total - own)))
    }
  }
  const chooseProceed = (id: string) => {
    if (id === selectedId) return
    const c = candidates.find((x) => x.id === id)
    if (c) { loadCandidateScores(c); setSelectedId(id) }
  }

  const built = partnerType ? WIZARD_BUILT[partnerType] : false

  const stepContent = (
    <>
      {step === 'type' && <TypeStep selected={partnerType} built={built} onSelect={setPartnerType} onNext={() => goToStep('candidates')} />}
      {step === 'candidates' && (
        <CandidatesStep candidates={pipelineCandidates} selectedId={selectedId} evalIds={evalIds} toggleEval={toggleEval} evaluated={evaluated}
          onAddLead={addLead} onRemoveLead={removeLead} onChoose={chooseProceed} updateCandidateEvaluation={updateCandidateEvaluation}
          infra={infra} setInfra={setInfra} ownFunds={ownFunds} setOwnFunds={setOwnFunds} ccLimit={ccLimit} setCcLimit={setCcLimit}
          infraTotal={infraTotal} finEval={finEval} financePass={financePass} channelPass={channelPass} viewingAs={viewingAs}
          onBack={() => setStep('type')} onNext={() => goToStep('evaluate')}
        />
      )}
      {step === 'evaluate' && (
        <EvaluateStep evaluated={evaluated} selectedId={selectedId} onChoose={chooseProceed} onReject={rejectCandidate}
          infra={infra} ownFunds={ownFunds} ccLimit={ccLimit}
          authority={authority} onBack={() => setStep('candidates')} onNext={goAfterEvaluate} />
      )}
      {step === 'finance-review' && (
        <ReviewStep kind="finance" code={flaggedCases.find((c) => c.candidateId === selected.id)?.code ?? ''} isReplacement={isReplacement} finEval={finEval} authority={authority}
          candidate={selected} onBack={() => setStep('evaluate')} onApprove={goAfterFinance} />
      )}
      {step === 'channel-review' && (
        <ReviewStep kind="channel" code={flaggedCases.find((c) => c.candidateId === selected.id)?.code ?? ''} isReplacement={isReplacement} infraTotal={infraTotal} authority={authority}
          candidate={selected} onBack={() => setStep('evaluate')} onApprove={() => goToStep('agreement')} />
      )}
      {step === 'agreement' && (
        <AgreementStep candidate={selected} authority={authority as 'SM' | 'RBL'} partnerType={partnerType}
          onBack={() => setStep('evaluate')} onNext={() => goToStep('success')} />
      )}
      {step === 'success' && (
        <SuccessStep candidate={selected} isReplacement={isReplacement} financePass={financePass} channelPass={channelPass}
          batchChosen={batchChosen}
          onRestart={() => { setStep('type'); setPartnerType(null); setBatchChosen([]) }} />
      )}
    </>
  )

  return (
    <div>
      <div className="page-head">
        <h1>New Application <span className="page-info-ic" title="Templatized by partner type — the documents and approval workflow change automatically based on who you're onboarding."><Icon name="help" size={13} /></span></h1>
      </div>

      {step === 'success' ? stepContent : (
        <div className="wizard-shell">
          <nav className="wizard-sidenav">
            {MAIN_STEPS.map((f, i) => (
              <button key={f.id} className={`wsn-item ${i < stepIndex ? 'done' : ''} ${i === stepIndex ? 'current' : ''}`}
                disabled={i > stepIndex} onClick={() => { if (i <= stepIndex) setStep(f.id) }}>
                <span className="n">{i < stepIndex ? '✓' : i + 1}</span><span className="wsn-label">{f.label}</span>
              </button>
            ))}
          </nav>
          <div className="wizard-content">{stepContent}</div>
        </div>
      )}
    </div>
  )
}

/* ---------- Step 1: partner type ---------- */
// Logistics Partner and Co-packer are upcoming — hidden from New Application until their wizards ship.
const VISIBLE_PARTNER_TYPES = PARTNER_TYPES.filter((t) => t.code !== 'logistics' && t.code !== 'copacker')

function TypeStep({ selected, built, onSelect, onNext }:
  { selected: PartnerTypeCode | null; built: boolean; onSelect: (t: PartnerTypeCode) => void; onNext: () => void }) {
  return (
    <div>
      <div className="pt-grid">
        {VISIBLE_PARTNER_TYPES.map((t) => (
          <button key={t.code} className={`pt-card ${selected === t.code ? 'sel' : ''} ${!t.isActive ? 'disabled' : ''}`}
            disabled={!t.isActive} onClick={() => onSelect(t.code)}>
            {!t.isActive && <span className="soon">Coming soon</span>}
            <div className="pt-top">
              <span className="pt-mark" style={{ background: PT_COLOR[t.code] }}>{t.label[0]}</span>
              <span className="pt-name">{t.label}</span>
            </div>
            <div className="pt-meta"><strong>{t.documents.length} documents</strong> · {t.workflow.length}-step workflow</div>
            <div className="pt-docs">{t.documents.slice(0, 4).map((d) => <span key={d}>{d}</span>)}</div>
          </button>
        ))}
      </div>
      {selected && !built && (
        <div className="gate-callout" style={{ marginTop: '1.1rem' }}>
          <span className="flag">Phase 2</span>
          <p>The <strong>{PARTNER_TYPES.find((t) => t.code === selected)?.label}</strong> template is configured, but its wizard ships in Phase 2. Pick <strong>Distributor</strong> to run the live flow.</p>
        </div>
      )}
      <div className="wizard-foot">
        <span className="muted-note">Selecting a type applies its template to every downstream step.</span>
        <Button disabled={!selected || !built} onClick={onNext}>Continue →</Button>
      </div>
    </div>
  )
}

/* ---------- Step 1.5: candidate pipeline (board + evaluate) ---------- */
function coverageTag(ol: number): { label: string; tone: 'good' | 'warn' | 'crit' } {
  return ol >= 2000 ? { label: 'High', tone: 'good' } : ol >= 1000 ? { label: 'Medium', tone: 'warn' } : { label: 'Low', tone: 'crit' }
}
const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

// Same override resolution the wizard's own Intake step uses (createLead's setOv calls) —
// rebuilt per-lead so the popup can show real values for ANY compared lead, not just whichever
// one is currently active in the wizard (the only one with a live overrides object).
function overridesForLead(c: CandidateCard, ext?: Extraction): Record<string, string> {
  const overrides: Record<string, string> = {
    'Agency / Firm name': c.name,
    Town: c.town,
    'Total Monthly Turnover of the Firm': String(c.turnoverMonthly),
    'Expected RCPL turnover per month': String(c.expectedRcplTurnover),
  }
  if (ext) {
    // Every Basic/Background/Coverage Information row this lead's own intake actually captured
    // wins over mock/recommendationForm.ts's shared static default — without this, a lead
    // sourced from a real uploaded workbook still showed the SAME generic SM Name/Companies
    // Handled/Agency Since/RCPL Contribution/etc. as every other lead in this modal's
    // "Recommendation Form" section, even though the raw "Original intake" dump further down
    // the same modal correctly showed the real values — a visible contradiction on one screen.
    // Matched by regex (not exact label equality) since the intake field's own wording
    // (lib/excelLead.ts / IntakeInbox.tsx) doesn't exactly mirror this file's display labels.
    const val = (re: RegExp) => mergedFields(ext).find((f) => re.test(f.label) && f.ok)?.value
    const set = (label: string, re: RegExp) => { const v = val(re); if (v) overrides[label] = v }
    set('State', /^state/i)
    set('Phone Number', /phone/i)
    set('SM Name', /^sm name/i)
    set('ASM Name', /^asm name/i)
    set('ASE Name', /^ase name/i)
    set('Companies Handled (name of companies)', /companies handled/i)
    set('Agency since (no. of years)', /agency since/i)
    set('RCPL contribution to overall business', /rcpl contribution/i)
    set("Overall firm's coverage (all companies — total OL count)", /overall firm.?s coverage/i)
    set('WS contribution % to his business', /ws contribution/i)
    set('RCPL Planned Coverage', /rcpl planned coverage/i)
    set('Working Capital required for business', /working capital/i)
  }
  return overrides
}

// Real email address when the lead came in over email intake; a plausible placeholder
// otherwise (seeded/directory leads carry no email on the CandidateCard itself).
function emailForCandidate(c: CandidateCard): string {
  const ext = c.sourceIntakeId ? EXTRACTIONS[c.sourceIntakeId] : undefined
  if (ext?.channel === 'email') return ext.source
  const emailField = ext ? mergedFields(ext).find((f) => /email/i.test(f.label) && f.ok)?.value : undefined
  if (emailField) return emailField
  return `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/(^\.|\.$)/g, '')}@example.com`
}

// Matches the Excel workbook's "New DB (new town opening) / Replacement DB / Additional DB (in
// same town)" dropdown labels exactly, so the wizard reads the same as the sheet it mirrors.
const SUBTYPE_LABEL: Record<ApplicationSubtype, string> = {
  new: 'New DB (new town opening)', replacement: 'Replacement DB', additional: 'Additional DB (in same town)',
}

// A labeled category block inside the popup — every section (Overview, Basic Information,
// Background Information, etc.) renders through this, so they stay visually separated
// instead of bleeding into one undifferentiated grid.
function LdSection({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="ld-divider" />
      <div className="ld-intake-head">
        <span className="ic-title" style={{ fontSize: '0.92rem' }}>{title}</span>
        {extra}
      </div>
      {children}
    </>
  )
}

// "View details" popup on a comparison lead — an AI Recommendation summary (confidence ring,
// predicted route, timeline, findings) beside a Business Summary + live scorecard, plus —
// when the lead came from Intake Review — the original intake extraction and quick actions.
function LeadDetailModal({ candidates, detailId, onClose, liveInfra, liveFin, factorScore, finPass, chanPass, onReject, onRequestInfo, onAccept }: {
  candidates: CandidateCard[]; detailId: string | null; onClose: () => void
  liveInfra: (c: CandidateCard) => number; liveFin: (c: CandidateCard) => number
  factorScore: (c: CandidateCard, key: string) => number
  finPass: (c: CandidateCard) => boolean; chanPass: (c: CandidateCard) => boolean
  onReject: (c: CandidateCard) => void; onRequestInfo: (c: CandidateCard) => void; onAccept: (c: CandidateCard) => void
}) {
  const c = candidates.find((x) => x.id === detailId)
  const ext = c?.sourceIntakeId ? EXTRACTIONS[c.sourceIntakeId] : undefined
  const overrides = c ? overridesForLead(c, ext) : {}
  // A doc uploaded on the Leads page (LeadDetail's "Upload"/"Replace" — see setCandidateDoc)
  // lives on the candidate itself (c.documents), separate from the intake extraction's own
  // received/missing flags (ext.documents). Merge them so a lead uploaded here shows up as
  // Received here too — an uploaded file always wins over the extraction's stale flag, and
  // this renders regardless of whether the lead has a source intake at all.
  const docsMerged = c ? REQUIRED_DOCS.map((name) => {
    const uploaded = c.documents?.[name]
    const extDoc = ext?.documents?.find((d) => d.name === name)
    return { name, received: !!uploaded || !!extDoc?.received, file: uploaded?.name ?? extDoc?.file, dataUrl: uploaded?.dataUrl }
  }) : []
  const [discFormOpen, setDiscFormOpen] = useState(false)
  const setCandidateDiscForm = useApp((s) => s.setCandidateDiscForm)
  const bg = (key: string) => {
    const f = BACKGROUND_INFORMATION.find((x) => x.key === key)
    if (!f) return '—'
    return `${overrides[f.label] ?? f.value}${f.suffix ? ` ${f.suffix}` : ''}`
  }

  // Same composite-confidence formula the Intake step uses, run against this lead's own
  // recorded (or live, if it's the active lead) scores — so every compared lead gets a real
  // AI outcome prediction here, not just the one currently in the wizard's Intake step.
  const infraTotal = c ? liveInfra(c) : 0
  const finEval = c ? liveFin(c) : 0
  const financePass = c ? finPass(c) : false
  const channelPass = c ? chanPass(c) : false
  const willAutoClear = financePass && channelPass
  const confidence = Math.round(Math.min(finEval, 120) / 120 * 50 + infraTotal / 10 * 50)
  const keyDrivers: { label: string; tone: 'good' | 'warn' | 'crit' }[] = [
    { label: financePass ? 'Turnover within RCPL range' : 'Turnover below RCPL range', tone: financePass ? 'good' : 'crit' },
    { label: 'Strong business history', tone: 'good' },
    { label: channelPass ? 'WS contribution good' : 'WS contribution medium', tone: channelPass ? 'good' : 'warn' },
    { label: channelPass ? 'Good geographic coverage' : 'Coverage below threshold', tone: channelPass ? 'good' : 'warn' },
  ]
  const nextStepLabel = willAutoClear ? 'Auto-clear' : (!financePass ? 'Route to Finance' : 'Route to Trade Marketing')
  const timelineText = willAutoClear ? '0.5 - 1 day' : '2.0 - 2.5 days'
  const stageTag = c ? (CANDIDATE_STAGES.find((s) => s.id === c.stage)?.label ?? c.stage) : ''

  return (
    <Modal
      open={!!c}
      onClose={onClose}
      size="lg"
      title={c ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span>{c.name}</span>
          <Pill tone={c.stage === 'active' ? 'good' : 'neutral'} dot>{stageTag}</Pill>
        </div>
      ) : 'Lead details'}
    >
      {c && (
        <div className="lead-detail-modal ldv2">
          <div className="ldv2-col ldv2-ai">
            <div className="ldv2-h">AI Recommendation</div>
            <div className="ldv2-ring-wrap">
              <div className="outcome-ring lg" style={{ ['--v' as string]: confidence, ['--ring-c' as string]: willAutoClear ? 'var(--good)' : 'var(--warn)' }}>
                <span><b>{confidence}%</b><small>Confidence</small></span>
              </div>
            </div>
            <div className="ldv2-route">{nextStepLabel}</div>
            <Pill tone={willAutoClear ? 'good' : 'warn'} dot>{willAutoClear ? 'High likelihood of auto-clear' : 'Needs review before clearing'}</Pill>
            <div className="ldv2-timeline"><Icon name="clock" size={13} /> Estimated timeline <b>{timelineText}</b></div>

            <div className="ldv2-h" style={{ marginTop: '1.1rem' }}>AI Findings</div>
            <div className="ldv2-findings">
              {keyDrivers.map((d) => (
                <div className="oh-driver-row" key={d.label}>
                  <Icon name={d.tone === 'good' ? 'approvals' : 'close'} size={13} />
                  <span>{d.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="ldv2-col ldv2-main">
            <div className="ldv2-h">Business Summary</div>
            <div className="ldv2-tiles">
              <div className="ldv2-tile"><div className="v">{bg('agency_since')}</div><div className="k">Years in Business</div></div>
              <div className="ldv2-tile"><div className="v">₹{c.turnoverMonthly}L</div><div className="k">Total Monthly Turnover</div></div>
              <div className="ldv2-tile"><div className="v">₹{c.expectedRcplTurnover}L</div><div className="k">RCPL Turnover (Est.)</div></div>
              <div className="ldv2-tile"><div className="v">{bg('rcpl_contribution')}</div><div className="k">RCPL Contribution to Business</div></div>
            </div>
            <div className="ldv2-contact-row">
              <div><Icon name="partners" size={14} /><span>Companies Handled<b>{bg('companies_handled')}</b></span></div>
              <div><Icon name="comms" size={14} /><span>Phone Number<b>{bg('phone')}</b></span></div>
            </div>

            <div className="ldv2-sc-head">
              <span className="ldv2-h">Recommendation – Scorecard</span>
              <span className="ldv2-overall"><b>{c.confidencePct}%</b><small>Overall Confidence</small></span>
            </div>
            <div className="ldv2-bars">
              {INFRA_FACTORS.map((f) => {
                const score = factorScore(c, f.key)
                return (
                  <div className="ldv2-bar-row" key={f.key}>
                    <span className="lbl">{f.label}</span>
                    <div className="bar"><i style={{ width: `${score * 10}%` }} /></div>
                    <span className="val">{score}/10</span>
                  </div>
                )
              })}
              <div className="ldv2-bar-row total"><span className="lbl">Total Score</span><span /><span className="val">{infraTotal.toFixed(1)}/10</span></div>
            </div>
          </div>

          <div className="ldv2-col-span-2">
            <div className="ic-head">
              <div>
                <div className="ic-title">New DB Appointment Recommendation Form</div>
                <div className="ic-sub">The exact fields from RCPL's appointment workbook — Basic Information, Background, Coverage &amp; Financials.</div>
              </div>
            </div>

            <LdSection title="Basic Information">
              <div className="ld-fields">
                {BASIC_INFORMATION.filter((f) => !f.showWhen).map((f) => (
                  <div className="ld-field" key={f.key}>
                    <span className="k">{f.label}</span>
                    <span className="v">{overrides[f.label] ?? f.value}{f.suffix ? ` ${f.suffix}` : ''}</span>
                  </div>
                ))}
                <div className="ld-field"><span className="k">New DB Type</span><span className="v">{c.dbCategory}</span></div>
                <div className="ld-field">
                  <span className="k">New DB / Replacement / Additional</span>
                  <span className="v" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {SUBTYPE_LABEL[c.subtype ?? 'new']}
                    {c.subtype === 'replacement' && c.discontinuationForm && (
                      <button className="btn text sm" style={{ fontWeight: 700 }} onClick={() => setDiscFormOpen(true)}>View form</button>
                    )}
                  </span>
                </div>
                {c.subtype === 'additional' && (
                  <div className="ld-field"><span className="k">If Additional DB, mention reason</span><span className="v">{c.additionalReason || '—'}</span></div>
                )}
                {c.subtype === 'replacement' && (
                  <div className="ld-field"><span className="k">If Replacement, mention OLD DB Code</span>
                    <span className="v">{c.oldDbCode ? `${c.oldDbCode}${c.oldDbName ? ` — ${c.oldDbName}` : ''}` : '—'}</span>
                  </div>
                )}
              </div>
            </LdSection>

            {c.discontinuationForm && (
              <DisengagementFormModal
                open={discFormOpen} onClose={() => setDiscFormOpen(false)}
                existing={c.discontinuationForm}
                submitLabel="Save changes"
                onSubmit={(form) => { setCandidateDiscForm(c.id, form); setDiscFormOpen(false) }}
              />
            )}

            <LdSection title="Background Information">
              <div className="ld-fields">
                {BACKGROUND_INFORMATION.map((f) => (
                  <div className="ld-field" key={f.key}>
                    <span className="k">{f.label}</span>
                    <span className="v">{overrides[f.label] ?? f.value}{f.suffix ? ` ${f.suffix}` : ''}</span>
                  </div>
                ))}
              </div>
            </LdSection>

            <LdSection title="Coverage Data">
              <div className="ld-fields">
                {COVERAGE_DATA.map((f) => (
                  <div className="ld-field" key={f.key}>
                    <span className="k">{f.label}</span>
                    <span className="v">{overrides[f.label] ?? f.value}{f.suffix ? ` ${f.suffix}` : ''}</span>
                  </div>
                ))}
              </div>
            </LdSection>

            <LdSection title="Financials — investment build-up">
              <div className="ld-fields">
                {FINANCIAL_BREAKDOWN.map((f) => (
                  <div className="ld-field" key={f.key}>
                    <span className="k">{f.label}</span>
                    <span className="v">{overrides[f.label] ?? f.value}{f.suffix ? ` ${f.suffix}` : ''}</span>
                  </div>
                ))}
                <div className="ld-field"><span className="k">Total Investment Required</span><span className="v">₹{TOTAL_INVESTMENT_REQUIRED}L</span></div>
              </div>
              <p className="muted-note" style={{ margin: '0.7rem 0 0' }}>
                Own Funds / CC Limit and the 8 Infrastructure factors are scored on the Evaluate step — they drive the Financial &amp; Channel Management Evaluations.
              </p>
            </LdSection>

            <div className="ic-turnover" style={{ marginTop: '0.9rem' }}>
              <div>
                <div className="ic-turnover-label">Expected RCPL turnover / month</div>
                <div className="ic-turnover-range">₹{c.expectedRcplTurnover}L</div>
              </div>
              <Pill tone={finEval >= 100 ? 'good' : 'warn'} dot>{c.expectedRcplTurnover > 50 ? 'RBL sign-off' : 'SM sign-off'}</Pill>
            </div>

            <LdSection title="Documents">
              <div className="ld-docs">
                {docsMerged.map((d) => (
                  <button key={d.name} type="button" className="ld-doc-btn" disabled={!d.received}
                    title={d.received ? `View ${d.name} in a new tab` : `${d.name} — not received`}
                    onClick={() => {
                      if (d.dataUrl) { window.open(d.dataUrl, '_blank'); return }
                      openPdfInNewTab(buildPdf([
                        { text: 'RCPL Partner Platform — Document on file', size: 9, gap: 18 },
                        { text: d.name, size: 18, bold: true, gap: 30 },
                        { text: c.name, size: 11, gap: 20 },
                        { text: `Status: Received${d.file ? ` — ${d.file}` : ''}`, size: 10.5, gap: 18 },
                        { text: ' ', gap: 20 },
                        { text: 'Generated preview PDF — prototype stand-in for the actual scan.', size: 8.5 },
                      ]))
                    }}>
                    <Pill tone={d.received ? 'good' : 'crit'} dot>{d.name}{d.received ? '' : ' — missing'}</Pill>
                    {d.received && <span className="ld-doc-view">View <Icon name="external" size={11} /></span>}
                  </button>
                ))}
              </div>
            </LdSection>

            <LdSection title="Lead under evaluation">
              <div className="ic-turnover">
                <div>
                  <div className="ic-turnover-label">{c.name}{c.isBestMatch && <span className="best-match">Best Match</span>}</div>
                  <div className="ic-turnover-range">{c.town} · {c.dbCategory} · {stageTag}</div>
                </div>
                <Pill tone="neutral">Infra {infraTotal.toFixed(1)}/10 · Financial {finEval}%</Pill>
              </div>
              <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Pill tone={willAutoClear ? 'good' : 'warn'} dot>
                  Recommendation Engine: {willAutoClear ? 'likely to auto-clear' : (!financePass ? 'likely to flag for Finance' : 'likely to flag for Trade Marketing')}
                </Pill>
                <Pill tone="ai">{c.confidencePct}% confidence</Pill>
              </div>
            </LdSection>
          </div>

          {ext && (
            <div className="ldv2-col-span-2">
              <LdSection title={`Original intake — ${ext.source}`}
                extra={<Pill tone={(ext.confidencePct ?? 0) >= 85 ? 'good' : (ext.confidencePct ?? 0) >= 60 ? 'warn' : 'crit'} dot>{ext.confidencePct ?? 0}% extraction confidence</Pill>}>
                {ext.duplicate && (
                  <div className="ir-dup" style={{ marginBottom: '0.9rem' }}>
                    <span className="ir-dup-ic"><Icon name="flag" size={14} /></span>
                    <div style={{ flex: 1 }}>
                      <div className="ir-dup-title">Possible duplicate</div>
                      <div className="ir-dup-note">{ext.duplicate}</div>
                    </div>
                  </div>
                )}
                {ext.summary && (
                  <div className="ir-summary" style={{ marginBottom: '0.9rem' }}>
                    <span className="ir-summary-tag"><Icon name="spark" size={12} /> Agent summary</span>
                    <span>{ext.summary}</span>
                  </div>
                )}
                <div className="ld-fields" style={{ marginBottom: '0.9rem' }}>
                  <div className="ld-field"><span className="k">Received</span><span className="v">{ext.receivedFull ?? ext.receivedAt}</span></div>
                  <div className="ld-field"><span className="k">Channel</span><span className="v">{ext.channel === 'email' ? 'Email' : 'Manual upload'}</span></div>
                  <div className="ld-field"><span className="k">Priority</span><span className="v">
                    <Pill tone={ext.priority === 'high' ? 'crit' : ext.priority === 'low' ? 'neutral' : 'warn'} dot>{ext.priority === 'high' ? 'High' : ext.priority === 'low' ? 'Low' : 'Normal'}</Pill>
                  </span></div>
                  <div className="ld-field"><span className="k">Region</span><span className="v">{ext.region ?? '—'}</span></div>
                  <div className="ld-field"><span className="k">Assigned to</span><span className="v">{ext.assignedTo ?? 'Unassigned'}</span></div>
                  <div className="ld-field"><span className="k">Partner type</span><span className="v">{ext.partnerType === 'vendor' ? 'Vendor' : 'Distributor'}</span></div>
                </div>
                <div className="ld-fields">
                  {mergedFields(ext).map((f) => (
                    <div className="ld-field" key={f.label}>
                      <span className="k">{f.label}</span>
                      <span className={`v ${f.ok ? '' : 'miss'}`}>{f.ok ? f.value : 'Missing'}</span>
                    </div>
                  ))}
                </div>
                {ext.attachments && ext.attachments.length > 0 && (
                  <div className="ir-attach" style={{ marginTop: '0.9rem' }}>
                    <div className="k">Attachments ({ext.attachments.length})</div>
                    <div className="ir-attach-list">
                      {ext.attachments.map((a) => (
                        <span className="ir-attach-chip" key={a}><Icon name="documents" size={12} /> {a}</span>
                      ))}
                    </div>
                  </div>
                )}
              </LdSection>
            </div>
          )}

          <div className="ldv2-actions">
            <Button variant="ghost" className="ldv2-reject" onClick={() => { onReject(c); onClose() }}>Reject Application</Button>
            <Button variant="ghost" onClick={() => { onRequestInfo(c); onClose() }}>Request More Info</Button>
            <Button onClick={() => { onAccept(c); onClose() }}>{nextStepLabel} →</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function CandidatesStep(p: {
  candidates: CandidateCard[]; selectedId: string; evalIds: string[]; toggleEval: (id: string) => void; evaluated: Evaluated[]
  onAddLead: (c: CandidateCard) => void; onRemoveLead: (id: string) => void
  infra: InfraState; setInfra: (s: InfraState) => void; ownFunds: number; setOwnFunds: (n: number) => void
  ccLimit: number; setCcLimit: (n: number) => void; infraTotal: number; finEval: number
  financePass: boolean; channelPass: boolean; onBack: () => void; onNext: () => void
  // Who's viewing — only Channel Development (and Admin, for demos) actually scores a DB;
  // everyone else (ASE/ASM/RBL) only ever sees whatever the workbook/evaluation already says.
  viewingAs: RoleCode
  // Switch which candidate's evaluation is "live" on the sliders — MUST reload that candidate's
  // own stored scores onto infra/ownFunds/ccLimit (see NewApplication's chooseProceed), or the
  // sliders keep showing whichever candidate was previously active, misattributed to the new one.
  onChoose: (id: string) => void
  // Persists a slider edit onto the ACTIVE candidate's own record — without this, moving a
  // slider only changed the shared live state, never actually saved anywhere per-candidate.
  updateCandidateEvaluation: (id: string, patch: { infraFactors?: InfraState; ownFunds?: number; ccLimit?: number }) => void
}) {
  const askCopilot = useApp((s) => s.askCopilot)
  const rejectCandidate = useApp((s) => s.rejectCandidate)
  const navigate = useNavigate()
  const [pickerOpen, setPickerOpen] = useState(false)
  // CarDekho-style compare controls (declared before the empty-state return — hooks order).
  const [diffOnly, setDiffOnly] = useState(false)
  const [highlightDiff, setHighlightDiff] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  // Narrows the lead list to one DB category before ticking, so you go straight to comparing
  // GTs with GTs instead of hunting through a mixed list (the tick-time lock still applies too).
  const [catFilter, setCatFilter] = useState<DbCategory | 'all'>('all')

  // Empty pipeline — Trade Marketing pulls in leads the field team created on the Leads
  // page (they land here automatically once shortlisted), or adds one from the directory.
  if (p.candidates.length === 0) {
    return (
      <div>
        <Card className="stack">
          <div style={{ textAlign: 'center', padding: '1.8rem 1rem' }}>
            <p style={{ fontWeight: 800, color: 'var(--ink)', fontSize: '1rem', marginBottom: '0.4rem' }}>No leads in the pipeline yet</p>
            <p className="muted-note" style={{ marginBottom: '1.1rem' }}>
              Leads the field team reviews &amp; shortlists on the Leads page appear here automatically, ready to compare — or pull one in from the distributor directory.
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button onClick={() => navigate('/leads')}><Icon name="leads" size={14} /> Open Leads</Button>
              <Button variant="ghost" onClick={() => setPickerOpen(true)}>+ Add from directory</Button>
            </div>
          </div>
        </Card>
        <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add a lead">
          <div className="lead-pick">
            {LEAD_CANDIDATES.map((lc) => (
              <div className="lead-pick-row" key={lc.id}>
                <div className="lp-main">
                  <div className="lp-name">{lc.name}</div>
                  <div className="lp-meta">{lc.town} · {lc.dbCategory} · ₹{lc.turnoverMonthly}L/mo · {lc.coverageOutlets.toLocaleString()} OL</div>
                </div>
                <Button size="sm" onClick={() => p.onAddLead(lc)}>+ Add</Button>
              </div>
            ))}
          </div>
        </Modal>
        <div className="wizard-foot">
          <Button variant="text" onClick={p.onBack}>← Back</Button>
          <Button disabled title="Add at least one lead to continue">Continue →</Button>
        </div>
      </div>
    )
  }

  const selected = p.candidates.find((c) => c.id === p.selectedId) ?? p.candidates[0]
  // Scoring a DB is Channel Development's call — ASE/ASM/RBL only ever see whatever the
  // uploaded workbook (or Channel Dev's own prior scoring) already says, never editable sliders.
  const canScore = p.viewingAs === 'channel_dev' || p.viewingAs === 'admin'
  const lockReason = !canScore
    ? 'Only Channel Development scores a DB — not editable here'
    : 'From the uploaded workbook — not editable here'
  // The selected lead's own required investment (workbook formula) — every other compared lead
  // gets its own via requiredInvestmentFor(c.turnoverMonthly, c.expectedRcplTurnover) below.
  const requiredInvestment = requiredInvestmentFor(selected.turnoverMonthly, selected.expectedRcplTurnover)
  const idealRequiredInvestment = requiredInvestmentFor(IDEAL_DB.turnoverMonthly, IDEAL_DB.expectedRcplTurnover)
  const stageIndex = CANDIDATE_STAGES.findIndex((s) => s.id === selected.stage)
  const evalCount = p.evalIds.length
  // Leads not already in the pipeline — the pool the "+ Add" picker offers.
  const availableLeads = LEAD_CANDIDATES.filter((lc) => !p.candidates.some((c) => c.id === lc.id))

  // The comparison shows only the leads ticked for evaluation — the same set the Evaluation
  // Agent scores. With nothing ticked yet, fall back to the active lead so the table isn't empty.
  // Capped at 3 side by side — beyond that the table gets unreadable, and 3 is the workbook's
  // own DB1/DB2/DB3 comparison width.
  const MAX_COMPARE = 3
  const ticked = p.candidates.filter((c) => p.evalIds.includes(c.id))
  const cols = (ticked.length ? ticked : [selected]).slice(0, MAX_COMPARE)
  // A comparison only makes sense within one DB category (GT vs GT, not GT vs GM) — the
  // workbook's thresholds and expected-turnover math differ by category, so mixing them would
  // score two candidates against the wrong bar. Once something's ticked, it locks the category.
  const compareCategory = ticked[0]?.dbCategory
  // "+ Add lead" can pull in a pipeline lead that isn't ticked yet, or a fresh one from the directory.
  const untickedInPipeline = p.candidates.filter((c) => !cols.some((col) => col.id === c.id))
  const untickedSameCategory = untickedInPipeline.filter((c) => !compareCategory || c.dbCategory === compareCategory)
  const canAddCompare = cols.length < MAX_COMPARE && (untickedSameCategory.length > 0 || availableLeads.some((lc) => !compareCategory || lc.dbCategory === compareCategory))

  // Side-by-side comparison rows. The active (selected) lead's infra/financial scores come from
  // the live sliders — the same numbers the Evaluate card shows; other leads use recorded scores.
  const liveInfra = (c: CandidateCard) => (c.id === selected.id ? p.infraTotal : c.infraScore)
  const liveFin = (c: CandidateCard) => (c.id === selected.id ? p.finEval : c.finEvalPct)
  // The active lead's per-factor scores come live off the sliders. Every other lead now has its
  // OWN real per-factor breakdown too (infraFactors) — read that directly instead of guessing;
  // only a candidate that predates infraFactors falls back to a deterministic approximation.
  const factorScore = (c: CandidateCard, key: string) => {
    if (c.id === selected.id) return p.infra[key]
    if (c.infraFactors?.[key] != null) return c.infraFactors[key]
    const h = [...(c.id + key)].reduce((a, ch) => a + ch.charCodeAt(0), 0)
    return Math.min(10, Math.max(1, Math.round(c.infraScore + ((h % 3) - 1))))
  }
  // Active lead's capital comes from the live sliders; every other lead now has its own real
  // Own Funds + CC Limit recorded — read that directly rather than reverse-deriving it from finEvalPct.
  const capital = (c: CandidateCard) =>
    c.id === selected.id ? p.ownFunds + p.ccLimit
      : (c.ownFunds != null && c.ccLimit != null) ? c.ownFunds + c.ccLimit
        : Math.round((requiredInvestmentFor(c.turnoverMonthly, c.expectedRcplTurnover) * c.finEvalPct) / 100)
  const chanPass = (c: CandidateCard) => liveInfra(c) >= INFRA_THRESHOLD && contributionPctFor(c.turnoverMonthly, c.expectedRcplTurnover) >= CONTRIBUTION_MIN
  const finPass = (c: CandidateCard) => liveFin(c) >= FIN_EVAL_PASS

  type CmpRow = { label: string; value: (c: CandidateCard) => number; render?: (c: CandidateCard) => ReactNode; ideal: ReactNode; noBest?: boolean }
  const compareSections: { title: string; rows: CmpRow[] }[] = [
    {
      title: 'Parameters & Scores',
      rows: [
        { label: 'Monthly turnover (₹L)', value: (c) => c.turnoverMonthly, ideal: IDEAL_DB.turnoverMonthly },
        { label: 'Expected RCPL turnover/mo (₹L)', value: (c) => c.expectedRcplTurnover, ideal: IDEAL_DB.expectedRcplTurnover },
        {
          label: 'Overall coverage (outlets)', value: (c) => c.coverageOutlets, ideal: IDEAL_DB.coverageOutlets.toLocaleString(),
          render: (c) => <>{c.coverageOutlets.toLocaleString()} <Pill tone={coverageTag(c.coverageOutlets).tone}>{coverageTag(c.coverageOutlets).label}</Pill></>,
        },
        { label: 'Lead confidence', value: (c) => c.confidencePct, render: (c) => `${c.confidencePct}%`, ideal: '100%' },
      ],
    },
    {
      title: 'Channel evaluation — infrastructure',
      rows: [
        ...INFRA_FACTORS.map((f): CmpRow => ({
          label: f.label, value: (c) => factorScore(c, f.key), ideal: '8/10',
          render: (c) => c.id !== selected.id
            ? `${factorScore(c, f.key)}/10`
            : (!canScore || selected.evalFromSheet)
              ? (
                <span className="cell-slider locked" title={lockReason}>
                  <Icon name="lock" size={11} /> <b>{p.infra[f.key]}/10</b>
                </span>
              )
              : (
                <span className="cell-slider">
                  <input type="range" min={1} max={10} value={p.infra[f.key]}
                    onChange={(e) => {
                      const next = { ...p.infra, [f.key]: +e.target.value }
                      p.setInfra(next)
                      p.updateCandidateEvaluation(selected.id, { infraFactors: next })
                    }} />
                  <b>{p.infra[f.key]}/10</b>
                </span>
              ),
        })),
        { label: `Infrastructure score (avg of 7 · threshold ${INFRA_THRESHOLD.toFixed(1)})`, value: liveInfra, render: (c) => liveInfra(c).toFixed(1), ideal: IDEAL_DB.infraScore.toFixed(1) },
        {
          label: `RCPL contribution (threshold ${CONTRIBUTION_MIN}%)`,
          value: (c) => contributionPctFor(c.turnoverMonthly, c.expectedRcplTurnover),
          render: (c) => `${contributionPctFor(c.turnoverMonthly, c.expectedRcplTurnover)}%`,
          ideal: `${contributionPctFor(IDEAL_DB.turnoverMonthly, IDEAL_DB.expectedRcplTurnover)}%`,
        },
        {
          label: 'Channel check', value: (c) => (chanPass(c) ? 1 : 0), noBest: true, ideal: <Pill tone="good" dot>Clear</Pill>,
          render: (c) => <Pill tone={chanPass(c) ? 'good' : 'warn'} dot>{chanPass(c) ? 'Clear' : 'Below threshold'}</Pill>,
        },
      ],
    },
    {
      title: 'Financial evaluation & outcome',
      rows: [
        {
          label: 'Required investment (₹L)', noBest: true, ideal: idealRequiredInvestment,
          value: (c) => (c.id === selected.id ? requiredInvestment : requiredInvestmentFor(c.turnoverMonthly, c.expectedRcplTurnover)),
        },
        {
          label: 'Own funds / borrowed (₹L)', value: (c) => (c.id === selected.id ? p.ownFunds : -1), noBest: true, ideal: idealRequiredInvestment,
          render: (c) => c.id !== selected.id
            ? '—'
            : (!canScore || selected.evalFromSheet)
              ? (
                <span className="cell-slider locked" title={lockReason}>
                  <Icon name="lock" size={11} /> <b>{p.ownFunds}</b>
                </span>
              )
              : (
                <span className="cell-slider">
                  <input type="range" min={0} max={200} value={p.ownFunds} onChange={(e) => {
                    const v = +e.target.value
                    p.setOwnFunds(v)
                    p.updateCandidateEvaluation(selected.id, { ownFunds: v, ccLimit: p.ccLimit })
                  }} />
                  <b>{p.ownFunds}</b>
                </span>
              ),
        },
        {
          label: 'CC limit (₹L)', value: (c) => (c.id === selected.id ? p.ccLimit : -1), noBest: true, ideal: 0,
          render: (c) => c.id !== selected.id
            ? '—'
            : (!canScore || selected.evalFromSheet)
              ? (
                <span className="cell-slider locked" title={lockReason}>
                  <Icon name="lock" size={11} /> <b>{p.ccLimit}</b>
                </span>
              )
              : (
                <span className="cell-slider">
                  <input type="range" min={0} max={150} value={p.ccLimit} onChange={(e) => {
                    const v = +e.target.value
                    p.setCcLimit(v)
                    p.updateCandidateEvaluation(selected.id, { ownFunds: p.ownFunds, ccLimit: v })
                  }} />
                  <b>{p.ccLimit}</b>
                </span>
              ),
        },
        { label: 'Capital available (₹L)', value: capital, ideal: idealRequiredInvestment },
        { label: `Financial Evaluation (threshold ${FIN_EVAL_PASS}%)`, value: liveFin, render: (c) => `${liveFin(c)}%`, ideal: `${FIN_EVAL_PASS}%` },
        {
          label: 'Financial check', value: (c) => (finPass(c) ? 1 : 0), noBest: true, ideal: <Pill tone="good" dot>Clear</Pill>,
          render: (c) => <Pill tone={finPass(c) ? 'good' : 'crit'} dot>{finPass(c) ? 'Clear' : 'Out of range'}</Pill>,
        },
        {
          label: 'Route', value: (c) => (finPass(c) && chanPass(c) ? 1 : 0), noBest: true, ideal: <Pill tone="good">Auto-clear</Pill>,
          render: (c) => <Pill tone={finPass(c) && chanPass(c) ? 'good' : 'warn'}>{finPass(c) && chanPass(c) ? 'Auto-clear' : 'Needs review'}</Pill>,
        },
      ],
    },
  ]
  const rowDiffers = (r: CmpRow) => { const vals = cols.map(r.value); return vals.some((v) => v !== vals[0]) }
  const visibleSections = compareSections
    .map((s) => ({ ...s, rows: diffOnly && cols.length > 1 ? s.rows.filter(rowDiffers) : s.rows }))
    .filter((s) => s.rows.length > 0)

  const visibleCandidates = p.candidates.filter((c) => catFilter === 'all' || c.dbCategory === catFilter)

  return (
    <div className="cand-layout">
      <aside className="cand-list">
        <div className="cand-list-head">
          <span className="t">Leads ({catFilter === 'all' ? p.candidates.length : `${visibleCandidates.length} of ${p.candidates.length}`})</span>
          <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>+ Add</Button>
        </div>
        <select className="select" style={{ width: '100%', marginBottom: '0.6rem' }} value={catFilter}
          onChange={(e) => setCatFilter(e.target.value as DbCategory | 'all')} aria-label="Filter leads by DB category">
          <option value="all">All categories</option>
          {DB_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {visibleCandidates.length === 0 && (
          <p className="muted-note" style={{ margin: '0.4rem 0' }}>No leads in this category.</p>
        )}
        {visibleCandidates.map((c) => {
          const inEval = p.evalIds.includes(c.id)
          const cStage = CANDIDATE_STAGES.find((s) => s.id === c.stage)?.label ?? c.stage
          const categoryLocked = !inEval && !!compareCategory && c.dbCategory !== compareCategory
          return (
            <div key={c.id} className={`cand-item ${p.selectedId === c.id ? 'sel' : ''} ${inEval ? 'in-eval' : ''}`}
              onClick={() => p.onChoose(c.id)}>
              <input type="checkbox" checked={inEval} disabled={categoryLocked} onClick={(e) => e.stopPropagation()} onChange={() => p.toggleEval(c.id)}
                title={categoryLocked ? `Comparison is locked to ${compareCategory} — untick those first to compare a ${c.dbCategory} lead` : 'Include in batch evaluation'}
                aria-label={`Evaluate ${c.name}`} />
              <div>
                <div className="ci-name">{c.name}{c.isBestMatch && <span className="best-match">Best Match</span>}</div>
                <div className="ci-meta">{c.town} · {c.dbCategory}</div>
                <div className="ci-foot"><span className="ci-stage">{cStage}</span><span className="ci-conf">{c.confidencePct}%</span></div>
              </div>
              <button className="cand-del" title="Remove lead" aria-label={`Remove ${c.name}`}
                disabled={p.candidates.length <= 1}
                onClick={(e) => { e.stopPropagation(); p.onRemoveLead(c.id) }}>×</button>
            </div>
          )
        })}
        <p className="muted-note" style={{ marginTop: '0.2rem' }}>{evalCount === 0 ? 'Tick the leads you want to evaluate' : `${evalCount} selected for evaluation — tick to add or remove`}</p>
      </aside>

      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add a lead">
        {compareCategory && (untickedInPipeline.length > untickedSameCategory.length || availableLeads.some((lc) => lc.dbCategory !== compareCategory)) && (
          <p className="muted-note" style={{ marginBottom: '0.9rem', fontStyle: 'normal' }}>
            Comparison is locked to <strong>{compareCategory}</strong> — leads in other categories are hidden here. Untick the current comparison to switch categories.
          </p>
        )}
        {untickedSameCategory.length > 0 && (
          <>
            <p className="muted-note" style={{ marginBottom: '0.9rem', fontStyle: 'normal' }}>
              Already in this application's pipeline — add to the comparison.
            </p>
            <div className="lead-pick" style={{ marginBottom: '1.1rem' }}>
              {untickedSameCategory.map((lc) => (
                <div className="lead-pick-row" key={lc.id}>
                  <div className="lp-main">
                    <div className="lp-name">{lc.name}</div>
                    <div className="lp-meta">{lc.town} · {lc.dbCategory} · ₹{lc.turnoverMonthly}L/mo · {lc.coverageOutlets.toLocaleString()} OL</div>
                  </div>
                  <Button size="sm" onClick={() => { p.toggleEval(lc.id); setPickerOpen(false) }}>+ Compare</Button>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="muted-note" style={{ marginBottom: '0.9rem', fontStyle: 'normal' }}>
          Distributors surfaced by the Lead Generation Agent. Add one to this application's pipeline to score and evaluate it.
        </p>
        {availableLeads.filter((lc) => !compareCategory || lc.dbCategory === compareCategory).length === 0 ? (
          <div className="lead-pick-empty">Every surfaced lead is already in the pipeline.</div>
        ) : (
          <div className="lead-pick">
            {availableLeads.filter((lc) => !compareCategory || lc.dbCategory === compareCategory).map((lc) => (
              <div className="lead-pick-row" key={lc.id}>
                <div className="lp-main">
                  <div className="lp-name">{lc.name}</div>
                  <div className="lp-meta">{lc.town} · {lc.dbCategory} · ₹{lc.turnoverMonthly}L/mo · {lc.coverageOutlets.toLocaleString()} OL</div>
                </div>
                <Button size="sm" onClick={() => p.onAddLead(lc)}>+ Add</Button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <LeadDetailModal candidates={p.candidates} detailId={detailId} onClose={() => setDetailId(null)}
        liveInfra={liveInfra} liveFin={liveFin} factorScore={factorScore} finPass={finPass} chanPass={chanPass}
        onReject={(cand) => rejectCandidate(cand.id)}
        onRequestInfo={(cand) => askCopilot(`Get more information about ${cand.name}'s application before deciding.`)}
        onAccept={(cand) => { p.onChoose(cand.id); p.onNext() }}
      />

      <div className="cand-detail">
      <Card className="stack">
        <div className="ic-head">
          <span className="ic-icon"><Icon name="partners" size={16} /></span>
          <div>
            <div className="ic-title">Compare leads</div>
            <div className="ic-sub">
              {ticked.length ? `Comparing ${cols.length} of ${ticked.length} ticked lead${ticked.length > 1 ? 's' : ''}` : 'Tick leads on the left to compare them side by side'}
              {ticked.length > MAX_COMPARE && ` — up to ${MAX_COMPARE} at a time; untick one on the left to swap in another`}.
              {' '}<span className="best-mark">✓</span> marks the best value in each row; click a lead's card to make it the active one scored by the sliders below.
            </div>
          </div>
        </div>

        <div className="dtable-wrap compare-wrap" style={{ border: 'none' }}>
          <table className="dtable db-compare">
            <thead>
              <tr>
                <th className="param-col compare-controls">
                  <label className="cc-check">
                    <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} />
                    Hide common rows
                  </label>
                  <label className="cc-check">
                    <input type="checkbox" checked={highlightDiff} onChange={(e) => setHighlightDiff(e.target.checked)} />
                    Highlight differences
                  </label>
                </th>
                {cols.map((c) => {
                  const active = c.id === selected.id
                  return (
                    <th key={c.id} className={`lead-col ${active ? 'db1-col' : ''}`} onClick={() => p.onChoose(c.id)}
                      title={active ? undefined : `Make ${c.name} the active lead`}>
                      <span className="cc-vs">VS</span>
                      <div className="cc-card">
                        {cols.length > 1 && (
                          <button className="cc-remove" title={`Remove ${c.name} from comparison`} aria-label={`Remove ${c.name} from comparison`}
                            onClick={(e) => { e.stopPropagation(); p.toggleEval(c.id) }}>×</button>
                        )}
                        <span className="cc-avatar">{initials(c.name)}</span>
                        <div className="cc-name">{c.name}</div>
                        {c.isBestMatch && <span className="best-match">Best Match</span>}
                        <div className="cc-meta">{c.town} · {c.dbCategory}</div>
                        <div className="cc-price">₹{c.expectedRcplTurnover}L<span className="cc-price-cap">Expected RCPL turnover/mo</span></div>
                        <div className="cc-btn-row">
                          <button className={`cc-cta ${active ? 'on' : ''}`}
                            onClick={(e) => { e.stopPropagation(); p.onChoose(c.id) }}>
                            {active ? '● Active' : 'Activate'}
                          </button>
                          <button className="cc-details" onClick={(e) => { e.stopPropagation(); setDetailId(c.id) }}>
                            View details
                          </button>
                        </div>
                      </div>
                    </th>
                  )
                })}
                {canAddCompare && (
                  <th className="add-col" onClick={() => setPickerOpen(true)} title="Add another lead to compare">
                    <div className="cc-card cc-add">
                      <span className="cc-plus">+</span>
                      <div className="cc-add-label">Add lead</div>
                    </div>
                  </th>
                )}
                <th className="ideal">
                  <div className="cc-card">
                    <span className="cc-avatar cc-avatar-ideal">★</span>
                    <div className="cc-name">Ideal DB</div>
                    <div className="cc-meta">Territory benchmark</div>
                    <div className="cc-price">{IDEAL_DB.coverageOutlets.toLocaleString()}<span className="cc-price-cap">Target outlet coverage</span></div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleSections.map((s) => (
                <Fragment key={s.title}>
                  <tr className="compare-section">
                    <td colSpan={cols.length + 2 + (canAddCompare ? 1 : 0)}>{s.title}</td>
                  </tr>
                  {s.rows.map((r) => {
                    const vals = cols.map(r.value)
                    const max = Math.max(...vals)
                    const markBest = cols.length > 1 && !r.noBest
                    const differs = vals.some((v) => v !== vals[0])
                    return (
                      <tr key={r.label}>
                        <td className="strong param-col">{r.label}</td>
                        {cols.map((c, i) => (
                          <td key={c.id} className={`lead-val ${c.id === selected.id ? 'db1-col' : ''} ${markBest && vals[i] === max ? 'row-best' : ''} ${highlightDiff && differs ? 'cell-diff' : ''}`}>
                            {markBest && vals[i] === max && <span className="best-mark" title="Best across leads">✓ </span>}
                            {r.render ? r.render(c) : vals[i]}
                          </td>
                        ))}
                        {canAddCompare && <td className="add-col" />}
                        <td className="ideal">{r.ideal}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
              {visibleSections.length === 0 && (
                <tr><td className="compare-same" colSpan={cols.length + 2 + (canAddCompare ? 1 : 0)}>
                  These leads are identical on every parameter — untick "Hide common rows" to see all rows.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted-note" style={{ marginTop: '0.5rem' }}>"Ideal DB" is the benchmark for this territory's coverage plan, not a real lead. The sliders in <strong>{selected.name}</strong>'s column score it live; other ticked leads show their recorded scores.</p>
        <p className="muted-note">
          Currently <strong>{CANDIDATE_STAGES[stageIndex].label}</strong> — continuing to Evaluate moves <strong>{selected.name}</strong> to Pending, and it advances automatically as it clears each review.
        </p>
      </Card>

        <div className="wizard-foot">
          <Button variant="text" onClick={p.onBack}>← Back</Button>
          <Button disabled={evalCount === 0} onClick={p.onNext}
            title={evalCount === 0 ? 'Tick at least one lead to evaluate' : undefined}>Continue →</Button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Step 4: evaluation (batch — score every selected candidate, compare forks) ---------- */
interface Evaluated { c: CandidateCard; fin: number; infra: number; financePass: boolean; channelPass: boolean }
interface DocField { k: string; claimed: string; extracted: string; ok: boolean }
interface EvalDoc { name: string; file: string; fields: DocField[] }
const routeLabel = (e: Evaluated): { label: string; tone: 'good' | 'warn' | 'crit' } => {
  if (e.financePass && e.channelPass) return { label: 'Auto-clear', tone: 'good' }
  const to = [!e.financePass && 'Finance', !e.channelPass && 'Trade Marketing'].filter(Boolean).join(' + ')
  return { label: `→ ${to}`, tone: e.financePass || e.channelPass ? 'warn' : 'crit' }
}

// The documents the Document Intelligence Agent reads for the proceeding candidate. Each
// carries the fields it extracted and whether they matched the claimed values.
function docsForCandidate(c: CandidateCard): EvalDoc[] {
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return [
    { name: 'GST Certificate', file: `GST_${slug}.pdf`, fields: [
      { k: 'GSTIN', claimed: '27ABCPD1234K1Z5', extracted: '27ABCPD1234K1Z5', ok: true },
      { k: 'Legal name', claimed: c.name, extracted: c.name, ok: true },
    ] },
    { name: 'DB Onboarding Form', file: `DB_Form_${slug}.pdf`, fields: [
      { k: 'Firm name', claimed: c.name, extracted: c.name.replace(/s$/, ''), ok: false },
      { k: 'Contact person', claimed: 'On file', extracted: 'On file', ok: true },
      { k: 'DB category', claimed: c.dbCategory, extracted: c.dbCategory, ok: true },
    ] },
    { name: 'Godown Proof', file: `Godown_${slug}.pdf`, fields: [
      { k: 'Warehouse address', claimed: `Plot 14, MIDC ${c.town}`, extracted: `Plot 14, MIDC ${c.town}`, ok: true },
      { k: 'Area (sq ft)', claimed: '4,500', extracted: '4,500', ok: true },
    ] },
  ]
}

function EvaluateStep(p: {
  evaluated: Evaluated[]; selectedId: string; onChoose: (id: string) => void; onReject: (id: string) => void
  infra: InfraState; ownFunds: number; ccLimit: number
  authority: string; onBack: () => void; onNext: (chosen: Evaluated[]) => void
}) {
  const [done, setDone] = useState(false)
  // Once the agent finishes, freeze the results so switching the selected partner
  // in the results table doesn't restart the animation or reset the table.
  const [frozenEval, setFrozenEval] = useState<Evaluated[] | null>(null)
  const [frozenLines, setFrozenLines] = useState<TraceLine[] | null>(null)
  // Checkbox selection: which leads are checked; the last-checked is the one to proceed with.
  const [checkedIds, setCheckedIds] = useState<string[]>([p.selectedId])
  const [proceedId, setProceedId] = useState<string>(p.selectedId)
  const [docOn, setDocOn] = useState(false)
  const [openDetail, setOpenDetail] = useState<string | null>(null)
  const [docView, setDocView] = useState<EvalDoc | null>(null)
  const displayEval = frozenEval ?? p.evaluated
  const multi = displayEval.length > 1
  const clears = displayEval.filter((e) => e.financePass && e.channelPass).length
  const proceed = displayEval.find((e) => e.c.id === proceedId) ?? displayEval.find((e) => checkedIds.includes(e.c.id)) ?? displayEval[0]

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      // Always keep at least one checked; if unchecking the current proceed target, switch to the first remaining
      if (next.length === 0) return prev
      if (!next.includes(proceedId)) setProceedId(next[0])
      return next
    })
  }

  // Reject drops the lead out of this comparison entirely — it stays on the Leads page
  // (tagged 'rejected', see rejectCandidate in store.ts) rather than being deleted outright.
  const rejectRow = (id: string) => {
    p.onReject(id)
    setCheckedIds((prev) => prev.filter((x) => x !== id))
    setFrozenEval((prev) => (prev ? prev.filter((e) => e.c.id !== id) : prev))
    setProceedId((prev) => (prev === id ? '' : prev))
  }

  if (!proceed) {
    return (
      <div>
        <Card title="Evaluation Agent">
          <p className="muted-note">No leads are ticked for evaluation. Go back to the Leads step and tick at least one to score.</p>
        </Card>
        <div className="wizard-foot">
          <Button variant="text" onClick={p.onBack}>← Back</Button>
        </div>
      </div>
    )
  }

  const diDocs = docsForCandidate(proceed.c)
  const diMismatches = diDocs.reduce((n, d) => n + d.fields.filter((f) => !f.ok).length, 0)

  const routeExplain = (e: Evaluated): string => {
    if (e.financePass && e.channelPass) return `Both evaluations clear the bar — ${e.c.name} auto-clears straight to agreement with ${p.authority} sign-off.`
    const parts: string[] = []
    if (!e.financePass) parts.push(`Financial Evaluation at ${e.fin}% is below the ${FIN_EVAL_PASS}% required, so it routes to Finance`)
    if (!e.channelPass) parts.push(`Channel score ${e.infra.toFixed(1)}/10 is under the ${INFRA_THRESHOLD}/10 bar, so it routes to Trade Marketing`)
    return `${parts.join('; ')}.`
  }

  const liveLines: TraceLine[] = [
    { text: `> Evaluation Agent — running the approval matrix on ${p.evaluated.length} lead${multi ? 's' : ''}`, tone: 'accent' },
    ...p.evaluated.map((e) => {
      const pass = e.financePass && e.channelPass
      const route = pass ? 'AUTO-CLEAR' : `route to ${[!e.financePass && 'Finance', !e.channelPass && 'Trade Marketing'].filter(Boolean).join(' + ')}`
      return { text: `${e.c.name}: Financial ${e.fin}% ${e.financePass ? '≥100% ✓' : '<100% ✗'} · Channel ${e.infra.toFixed(1)}/10 ${e.channelPass ? '✓' : '✗'} → ${route}`, tone: pass ? 'ok' : 'bad' } as TraceLine
    }),
    { text: `Approval authority: expected RCPL turnover ₹${EXPECTED_RCPL_TURNOVER}L → ${p.authority} sign-off.`, tone: 'muted' },
    { text: `Decision: ${clears} auto-clear, ${p.evaluated.length - clears} need review.`, tone: 'accent' },
  ]
  // After freezing, use the snapshot; before freezing, stream the live lines.
  const lines = frozenLines ?? liveLines

  return (
    <div>
      <Card title="Evaluation Agent">
        <AgentTrace lines={lines} onDone={() => { setDone(true); setFrozenEval(p.evaluated); setFrozenLines(liveLines) }} />
        {done && (
          <>
            <div className="mono-label" style={{ margin: '1.1rem 0 0.5rem' }}>
              EVALUATION RESULTS — {displayEval.length} LEAD{multi ? 'S' : ''}{multi ? ' · SELECT WHICH TO PROCEED WITH' : ''} · OPEN A ROW FOR THE FULL SCORECARD
            </div>
            <div className="dtable-wrap">
              <table className="dtable eval-compare">
                <thead>
                  <tr>
                    <th style={{ width: 40 }} />
                    <th>Lead</th>
                    <th>Financial Evaluation</th>
                    <th>Channel Evaluation</th>
                    <th>Outcome</th>
                    <th style={{ width: 90 }}>Details</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {displayEval.map((e) => {
                    const r = routeLabel(e)
                    const isChecked = checkedIds.includes(e.c.id)
                    const isProceed = e.c.id === proceedId
                    const open = openDetail === e.c.id
                    const requiredInv = requiredInvestmentFor(e.c.turnoverMonthly, e.c.expectedRcplTurnover)
                    const avail = Math.round((e.fin / 100) * requiredInv)
                    const gap = Math.max(0, Math.round((requiredInv - avail) * 10) / 10)
                    return (
                      <Fragment key={e.c.id}>
                        <tr className={`clickable ${isProceed ? 'eval-chosen' : ''}`}
                          onClick={() => { toggleCheck(e.c.id); if (!isChecked) setProceedId(e.c.id) }}>
                          <td onClick={(ev) => ev.stopPropagation()}>
                            <input type="checkbox" checked={isChecked}
                              onChange={() => { toggleCheck(e.c.id); if (!isChecked) setProceedId(e.c.id) }}
                              aria-label={`Select ${e.c.name}`} />
                          </td>
                          <td className="strong">
                            {e.c.name}{e.c.isBestMatch && <span className="best-match">Best Match</span>}
                            {isProceed && isChecked && <span className="best-match" style={{ background: 'var(--accent)', marginLeft: '0.4rem' }}>→ Proceed</span>}
                          </td>
                          <td><Pill tone={e.financePass ? 'good' : 'crit'} dot>{e.fin}% {e.financePass ? 'Clear' : 'Out of range'}</Pill></td>
                          <td><Pill tone={e.channelPass ? 'good' : 'warn'} dot>{e.infra.toFixed(1)}/10 {e.channelPass ? 'Clear' : 'Below'}</Pill></td>
                          <td><Pill tone={r.tone}>{r.label}</Pill></td>
                          <td onClick={(ev) => ev.stopPropagation()}>
                            <button className="btn text sm eval-detail-btn" onClick={() => setOpenDetail(open ? null : e.c.id)}>
                              {open ? 'Hide ▲' : 'Details ▾'}
                            </button>
                          </td>
                          <td onClick={(ev) => ev.stopPropagation()}>
                            <button className="btn ghost sm" onClick={() => rejectRow(e.c.id)}>Reject</button>
                          </td>
                        </tr>
                        {open && (
                          <tr className="eval-detail-row">
                            <td colSpan={7}>
                              <div className="eval-detail">
                                <div className="ed-panel">
                                  <div className="ed-h">Financial Evaluation</div>
                                  <div className="ed-line"><span>Required investment</span><b>₹{requiredInv}L</b></div>
                                  <div className="ed-line"><span>Capital available (recorded)</span><b>₹{avail}L</b></div>
                                  <div className="ed-line"><span>Coverage of required</span><b>{e.fin}%</b></div>
                                  <div className="ed-line"><span>Shortfall vs required</span><b>{gap > 0 ? `₹${gap}L` : 'None'}</b></div>
                                  <div className="ed-line ed-total"><span>Threshold {FIN_EVAL_PASS}%</span><Pill tone={e.financePass ? 'good' : 'crit'} dot>{e.financePass ? 'Clear' : 'Out of range'}</Pill></div>
                                </div>
                                <div className="ed-panel">
                                  <div className="ed-h">Channel Management Evaluation</div>
                                  <div className="ed-line"><span>Infrastructure score (recorded)</span><b>{e.infra.toFixed(1)}/10</b></div>
                                  <div className="ed-line ed-total"><span>Threshold {INFRA_THRESHOLD}</span><Pill tone={e.channelPass ? 'good' : 'warn'} dot>{e.infra.toFixed(1)}/10 {e.channelPass ? 'Clear' : 'Below'}</Pill></div>
                                </div>
                              </div>
                              <div className="ed-route"><Icon name="spark" size={13} /><span>{routeExplain(e)}</span></div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted-note" style={{ marginTop: '0.6rem' }}>
              The Evaluation Agent scored each ticked lead against its own required investment (turnover ÷ 30 × {WORKING_CAPITAL_DAYS} working-capital days) and the {INFRA_THRESHOLD}/10 infrastructure bar.
              {checkedIds.length > 1
                ? ` All ${checkedIds.length} checked leads will be submitted — each is routed to Finance, Trade Marketing, or auto-cleared based on its result.`
                : ` Proceeding carries ${proceed?.c.name} into ${proceed?.financePass && proceed?.channelPass ? 'agreement (auto-cleared)' : 'the required review(s)'}.`}
            </p>

            <div className="mono-label" style={{ margin: '1.1rem 0 0.5rem' }}>OPTIONAL</div>
            <Toggle on={docOn} onChange={setDocOn} label={<><strong>Document Intelligence Agent</strong> — {docOn ? 'extracting & matching' : 'off (RCPL doesn\'t verify capacity claims today)'}</>} />
            {docOn && (
              <div className="di-block">
                <div className="di-head">
                  <span>Documents read for <strong>{proceed.c.name}</strong> — {diDocs.length} files</span>
                  {diMismatches > 0
                    ? <Pill tone="warn" dot>{diMismatches} field mismatch{diMismatches > 1 ? 'es' : ''}</Pill>
                    : <Pill tone="good" dot>All fields match</Pill>}
                </div>
                <div className="di-docs">
                  {diDocs.map((d) => {
                    const okCount = d.fields.filter((f) => f.ok).length
                    const allOk = okCount === d.fields.length
                    return (
                      <div className="di-doc" key={d.name}>
                        <span className="di-doc-ic"><Icon name="documents" size={16} /></span>
                        <div className="di-doc-body">
                          <div className="di-doc-name">{d.name}</div>
                          <div className="di-doc-file">{d.file}</div>
                        </div>
                        <Pill tone={allOk ? 'good' : 'warn'} dot>{okCount}/{d.fields.length} fields match</Pill>
                        <Button variant="ghost" size="sm" onClick={() => setDocView(d)}><Icon name="external" size={13} /> View</Button>
                      </div>
                    )
                  })}
                </div>
                <p className="muted-note" style={{ marginTop: '0.6rem' }}>Open any document to see the extracted fields matched against what the applicant claimed.</p>
              </div>
            )}
          </>
        )}
      </Card>

      <Modal open={!!docView} onClose={() => setDocView(null)} title={docView?.name ?? 'Document'} size="lg">
        {docView && (
          <>
            <div className="doc-preview">
              <Icon name="documents" size={30} />
              <div className="doc-preview-name">{docView.file}</div>
              <div className="doc-preview-source">Document Intelligence Agent · extracted {docView.fields.length} field{docView.fields.length > 1 ? 's' : ''} from this file</div>
            </div>
            <div className="dtable-wrap" style={{ marginTop: '0.9rem' }}>
              <table className="dtable">
                <thead><tr><th>Field</th><th>Claimed</th><th>Extracted</th><th>Match</th></tr></thead>
                <tbody>
                  {docView.fields.map((f) => (
                    <tr key={f.k}>
                      <td className="strong">{f.k}</td>
                      <td>{f.claimed}</td>
                      <td>{f.extracted}</td>
                      <td className={f.ok ? 'match-ok' : 'match-bad'}>{f.ok ? '✓' : '!'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>

      <div className="wizard-foot">
        <Button variant="text" onClick={p.onBack}>← Back</Button>
        <Button disabled={!done || checkedIds.length === 0} onClick={() => {
          const chosen = displayEval.filter((e) => checkedIds.includes(e.c.id))
          p.onNext(chosen.length ? chosen : [proceed!])
        }}>
          Continue with {checkedIds.length > 1 ? `${checkedIds.length} leads` : (proceed?.c.name ?? 'selected lead')} →
        </Button>
      </div>
    </div>
  )
}

/* ---------- Step 5: reviews (finance + channel) ---------- */
function ReviewStep(p: {
  kind: 'finance' | 'channel'; code: string; isReplacement: boolean; finEval?: number; infraTotal?: number; authority: string
  candidate: CandidateCard; onBack: () => void; onApprove: () => void
}) {
  const finance = p.kind === 'finance'
  const teamLabel = finance ? 'Finance' : 'Trade Marketing'
  const teamColor = finance ? 'var(--p-finance)' : 'var(--p-channel)'
  // This candidate's own required investment (workbook formula), not a flat figure.
  const requiredInvestment = requiredInvestmentFor(p.candidate.turnoverMonthly, p.candidate.expectedRcplTurnover)
  // The approve/reject decision belongs to the owning team — only they (or admin) see it.
  // An ASE/ASM viewing this flow can read it and reply in the thread, but not approve on the team's behalf.
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const navigate = useNavigate()
  const isReviewer = viewingAs === (finance ? 'finance' : 'channel_dev') || viewingAs === 'admin'
  // The case this wizard raised in the shared Approvals queue — approving/rejecting must happen
  // there (or via the reviewer controls below, which write to the same place), never just by
  // clicking through the wizard as someone who isn't the owning team.
  const caseRecord = useApp((s) => s.flaggedCases.find((c) => c.code === p.code))
  const decideCase = useApp((s) => s.decideCase)
  const requestInfoFromAsm = useApp((s) => s.requestInfoFromAsm)
  const logAudit = useApp((s) => s.logAudit)
  const pushNotification = useApp((s) => s.pushNotification)
  const alreadyApproved = caseRecord?.status === 'approved'
  const me = DEMO_USERS[viewingAs]
  const [msgs, setMsgs] = useState(() => finance
    ? [
        { who: 'R. Malhotra', role: 'ASM · 2h ago', txt: 'This distributor already services 3 other FMCG majors here with strong retailer feedback.', color: 'var(--p-ase)' },
        { who: 'Finance', role: '35m ago', txt: 'Thanks — funds are short of the required investment. Can we get a top-up commitment in writing?', color: 'var(--p-finance)' },
      ]
    : [
        { who: 'R. Malhotra', role: 'ASM · 1h ago', txt: 'Godown expansion is planned next month — coverage should improve once done.', color: 'var(--p-ase)' },
        { who: 'Trade Marketing', role: '20m ago', txt: 'Noted — can you share the expansion timeline in writing before we clear this?', color: 'var(--p-channel)' },
      ])
  const [draft, setDraft] = useState('')
  const briefing = finance
    ? `Replacement DB in Nashik with strong ASE-attested coverage and turnover fit. Sole blocker: Financial Evaluation at ${p.finEval}% — own funds + CC limit fall short of the ₹${requiredInvestment}L required investment. Expected RCPL turnover ₹${EXPECTED_RCPL_TURNOVER}L ⇒ ${p.authority} sign-off. Form and documents read for you — recommend conditional approval pending a written top-up commitment.`
    : `Strong financial position and turnover fit for Nashik. Sole blocker is the Channel Management Evaluation score, below the ${INFRA_THRESHOLD} threshold this coverage plan requires. Full form read for you.`
  const flagText = caseRecord?.flagDetail ?? (finance
    ? `CC limit + own funds are ${FIN_EVAL_PASS - (p.finEval ?? 0)}% below the ₹${requiredInvestment}L required investment (Financial Evaluation ${p.finEval}% vs ${FIN_EVAL_PASS}% required).`
    : `Channel Management Evaluation score (${p.infraTotal?.toFixed(1)}/10) is below the ${INFRA_THRESHOLD} threshold.`)

  const send = () => {
    if (!draft.trim()) return
    setMsgs((m) => [...m, { who: teamLabel, role: 'just now', txt: draft.trim(), color: teamColor }])
    setDraft('')
  }

  // Send Email — a real (mock) outbound email to the distributor, distinct from the internal
  // case-discussion thread above. Prefilled from the flag, editable before sending.
  const distributorEmail = emailForCandidate(p.candidate)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailSubject, setEmailSubject] = useState(`Action needed on your ${p.candidate.dbCategory} application — ${p.code}`)
  const [emailBody, setEmailBody] = useState(
    `Hi ${p.candidate.name} team,\n\nWe're reviewing your distributor application (${p.code}) and need your help closing out one item:\n\n${flagText}\n\nCould you share an update or supporting documents at your earliest convenience?\n\nThanks,\n${me.name}\n${ROLE_BY_CODE[viewingAs].label}, RCPL`,
  )
  const [emailSentNote, setEmailSentNote] = useState<string | null>(null)
  const sendEmail = () => {
    logAudit({ actor: me.name, kind: 'human', action: `Emailed ${p.candidate.name} (${distributorEmail}) re: ${p.code}`, entity: p.code })
    setEmailSentNote(`Email sent to ${distributorEmail} just now.`)
    setEmailOpen(false)
  }

  // Request info from ASE/ASM — same store action Approvals uses, so it opens the real case
  // thread and notifies the ASM, instead of the button being a dead click.
  const requestInfo = () => {
    if (!caseRecord) return
    requestInfoFromAsm({
      code: p.code, town: caseRecord.town, partnerName: p.candidate.name,
      reviewerRole: viewingAs, reviewerName: me.name,
      note: `More information needed on ${p.code} before we can proceed — ${flagText}`,
    })
    navigate('/communication')
  }

  // Note for Leadership — a lightweight, role-targeted notification + audit trail entry rather
  // than a whole new "leadership notes" data model; Leadership sees it in their bell and the
  // audit log already reads across every persona.
  const [leadershipNote, setLeadershipNote] = useState('')
  const [leadershipSentNote, setLeadershipSentNote] = useState<string | null>(null)
  const sendLeadershipNote = () => {
    if (!leadershipNote.trim()) return
    pushNotification({
      title: `Note on ${p.code} from ${teamLabel}`,
      body: leadershipNote.trim(),
      href: '/approvals',
      forRole: 'leadership',
    })
    logAudit({ actor: me.name, kind: 'human', action: `Left a note for Leadership on ${p.code}`, entity: p.code })
    setLeadershipSentNote('Leadership has been notified.')
    setLeadershipNote('')
  }

  // Decision panel (sidebar) — Approve / Conditional Approval / Reject, gated behind a
  // required reason so there's always an audit trail for why a call was made either way.
  const [decisionPick, setDecisionPick] = useState<'approved' | 'conditional' | 'rejected' | null>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const submitDecision = () => {
    if (!decisionPick || !decisionNote.trim()) return
    if (decisionPick === 'rejected') {
      decideCase(p.code, 'rejected')
      logAudit({ actor: me.name, kind: 'human', action: `Rejected case (${ROLE_BY_CODE[viewingAs].label}) — ${decisionNote.trim()}`, entity: p.code })
      pushNotification({ title: `${p.code} rejected`, body: `${p.candidate.name} — rejected by ${ROLE_BY_CODE[viewingAs].label}.`, href: '/approvals' })
      return
    }
    decideCase(p.code, 'approved')
    const conditional = decisionPick === 'conditional'
    logAudit({
      actor: me.name, kind: 'human',
      action: `${conditional ? 'Conditionally approved' : 'Approved'} case (${ROLE_BY_CODE[viewingAs].label}) — ${decisionNote.trim()}`,
      entity: p.code,
    })
    pushNotification({ title: `${p.code} ${conditional ? 'conditionally approved' : 'approved'}`, body: `${p.candidate.name} — ${conditional ? 'conditionally approved' : 'approved'} by ${ROLE_BY_CODE[viewingAs].label}.`, href: '/approvals' })
    p.onApprove()
  }

  // Review Summary numbers (sidebar) — finance and channel cases show different metrics.
  const available = finance ? Math.round((p.finEval ?? 0) / 100 * requiredInvestment * 10) / 10 : undefined
  const shortfall = finance ? Math.max(0, Math.round((requiredInvestment - (available ?? 0)) * 10) / 10) : undefined
  const shortfallPct = finance ? Math.max(0, FIN_EVAL_PASS - (p.finEval ?? 0)) : undefined

  return (
    <div className="review-layout">
      <div className="review-main">
        <div className="page-head" style={{ marginBottom: '0.9rem' }}>
          <h1>{p.code} · {caseRecord?.town ?? ''}{p.isReplacement ? ' · Replacement DB' : ''}</h1>
        </div>
        <div className="notify-bar" style={{ marginBottom: '1rem' }}>
          <Icon name="spark" size={14} /> Routed out of the ASM's hands. Review the {finance ? 'finance' : 'channel'} insights and take action.
        </div>

        <div className="review-briefing-card">
          <div className="rb-head">
            <span className="rb-icon"><Icon name="documents" size={16} /></span>
            <div className="rb-title">Approval Briefing</div>
          </div>
          <p className="rb-text">{briefing}</p>
          <div className="rb-flag">
            <Icon name="flag" size={13} />
            <span>{flagText}</span>
            <button type="button" className="rb-details-link" onClick={() => setDetailsOpen(true)}>View details</button>
          </div>
        </div>

        <Card title="Follow up before deciding" className="stack">
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" onClick={() => setEmailOpen(true)}><Icon name="mail" size={13} /> Email {p.candidate.name}</Button>
            <Button variant="ghost" size="sm" onClick={requestInfo}><Icon name="send" size={13} /> Request info from ASE/ASM</Button>
          </div>
          {emailSentNote && <p className="muted-note" style={{ margin: 0 }}><Icon name="check" size={12} /> {emailSentNote}</p>}
        </Card>

        <Card title="Note for Leadership" className="stack">
          <textarea className="input" rows={3} maxLength={500} placeholder="Add context Leadership should know about this case before it reaches their sign-off…"
            value={leadershipNote} onChange={(e) => setLeadershipNote(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
          <div className="row-between">
            <span className="char-count">{leadershipNote.length} / 500</span>
            <Button variant="ghost" size="sm" onClick={sendLeadershipNote} disabled={!leadershipNote.trim()}>Save Note</Button>
          </div>
          {leadershipSentNote && <p className="muted-note" style={{ margin: 0 }}><Icon name="check" size={12} /> {leadershipSentNote}</p>}
        </Card>

        <Modal open={emailOpen} onClose={() => setEmailOpen(false)} title={`Email ${p.candidate.name}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="field">
              <label>To</label>
              <input className="input" value={distributorEmail} disabled />
            </div>
            <div className="field">
              <label>Subject</label>
              <input className="input" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
            </div>
            <div className="field">
              <label>Message</label>
              <textarea className="input" rows={8} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
            </div>
            <div className="row-between" style={{ marginTop: '0.5rem' }}>
              <Button variant="ghost" onClick={() => setEmailOpen(false)}>Cancel</Button>
              <Button onClick={sendEmail}><Icon name="mail" size={13} /> Send email</Button>
            </div>
          </div>
        </Modal>

        <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Flag details">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <p style={{ fontSize: '0.86rem', color: 'var(--ink-soft)', lineHeight: 1.55 }}>{flagText}</p>
            {finance && (
              <div className="kv-grid">
                <div className="kv"><div className="k">Required investment</div><div className="v">₹{requiredInvestment}L</div></div>
                <div className="kv"><div className="k">Available (own + CC)</div><div className="v">₹{available}L</div></div>
                <div className="kv"><div className="k">Financial Evaluation</div><div className="v">{p.finEval}%</div></div>
                <div className="kv"><div className="k">Shortfall</div><div className="v">₹{shortfall}L ({shortfallPct}%)</div></div>
              </div>
            )}
            {!finance && (
              <div className="kv-grid">
                <div className="kv"><div className="k">Threshold</div><div className="v">{INFRA_THRESHOLD}/10</div></div>
                <div className="kv"><div className="k">Score</div><div className="v">{p.infraTotal?.toFixed(1)}/10</div></div>
              </div>
            )}
          </div>
        </Modal>

        <Card className="stack">
          <div>
            <div className="row-between" style={{ marginBottom: '0.6rem' }}>
              <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Case Discussion <Pill tone="ai" dot>{msgs.length}</Pill>
              </div>
            </div>
            <div className="rthread">
              {msgs.map((m, i) => (
                <div className="rmsg" key={i}>
                  <span className="avatar" style={{ background: m.color }}>{m.who.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                  <div style={{ flex: 1 }}>
                    <div className="who">{m.who}<span>{m.role}</span></div>
                    <div className="txt">{m.txt}</div>
                  </div>
                </div>
              ))}
            </div>
            <form className="rthread-input" onSubmit={(e) => { e.preventDefault(); send() }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Reply as ${teamLabel}…`} />
              <Button variant="ghost" size="sm" type="submit">Send</Button>
            </form>
            <p className="muted-note">✦ Communication Agent notified R. Malhotra (ASM) automatically.</p>
          </div>
        </Card>

        <div className="wizard-foot">
          <Button variant="text" onClick={p.onBack}>← Back</Button>
        </div>
      </div>

      <div className="review-side">
        <Card title="Review Summary" className="stack">
          {finance ? (
            <>
              <div className="rs-row"><span>Financial Evaluation</span><b>{p.finEval}%</b></div>
              <div className="rs-row"><span>Investment Required</span><b>₹{requiredInvestment}L</b></div>
              <div className="rs-row"><span>Available (Own + CC)</span><b>₹{available}L</b></div>
              {!!shortfall && (
                <div className="rs-row rs-crit"><span>Investment Shortfall</span><b>₹{shortfall}L ({shortfallPct}%)</b></div>
              )}
            </>
          ) : (
            <>
              <div className="rs-row"><span>Channel Management Evaluation</span><b>{p.infraTotal?.toFixed(1)}/10</b></div>
              <div className="rs-row"><span>Threshold</span><b>{INFRA_THRESHOLD}/10</b></div>
              {p.infraTotal !== undefined && p.infraTotal < INFRA_THRESHOLD && (
                <div className="rs-row rs-crit"><span>Score Gap</span><b>{(INFRA_THRESHOLD - p.infraTotal).toFixed(1)} pts</b></div>
              )}
            </>
          )}
        </Card>

        <Card title="Decision" className="stack">
          {isReviewer ? (
            <>
              <div className="decision-opts">
                {([
                  { key: 'approved', label: 'Approve', sub: 'Meets all requirements' },
                  { key: 'conditional', label: 'Conditional Approval', sub: 'Pending conditions to be met' },
                  { key: 'rejected', label: 'Reject', sub: 'Does not meet requirements' },
                ] as const).map((opt) => (
                  <label key={opt.key} className={`decision-opt ${decisionPick === opt.key ? 'on' : ''}`}>
                    <input type="radio" name="decision" checked={decisionPick === opt.key} onChange={() => setDecisionPick(opt.key)} />
                    <span>
                      <span className="d-label">{opt.label}</span>
                      <span className="d-sub">{opt.sub}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Reason / Notes (required)</label>
                <textarea className="input" rows={3} maxLength={500} placeholder="Add reason for your decision…"
                  value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
                <div className="char-count" style={{ textAlign: 'right', marginTop: '0.3rem' }}>{decisionNote.length} / 500</div>
              </div>
              <Button style={{ width: '100%' }} disabled={!decisionPick || !decisionNote.trim()} onClick={submitDecision}>Submit Decision</Button>
              <Button variant="ghost" size="sm" style={{ width: '100%' }} onClick={requestInfo}>Request info from ASE/ASM</Button>
            </>
          ) : alreadyApproved ? (
            <>
              <p className="muted-note" style={{ margin: 0 }}>Approved by {teamLabel} in Approvals — you can carry on.</p>
              <Button style={{ width: '100%' }} onClick={p.onApprove}>Continue →</Button>
            </>
          ) : (
            <>
              <Pill tone="warn" dot>Sent to {teamLabel}</Pill>
              <p className="muted-note" style={{ margin: 0 }}>
                The application can't move forward until {teamLabel} acts. Switch to the {teamLabel} persona or open Approvals to review it.
              </p>
            </>
          )}
        </Card>

        <Card title="Application Info" className="stack">
          <div className="rs-row"><span>Partner / Firm</span><b>{p.candidate.name}</b></div>
          <div className="rs-row"><span>Partner Type</span><b>{p.isReplacement ? 'Replacement DB' : p.candidate.dbCategory}</b></div>
          <div className="rs-row"><span>Region</span><b>{caseRecord?.town ?? ''}</b></div>
          <button type="button" className="rb-details-link" onClick={() => navigate('/leads')}>View full application →</button>
        </Card>
      </div>
    </div>
  )
}

/* ---------- Step 6: agreement ---------- */
function AgreementStep({ candidate, authority, partnerType, onBack, onNext }: {
  candidate: CandidateCard; authority: 'SM' | 'RBL'; partnerType: PartnerTypeCode | null; onBack: () => void; onNext: () => void
}) {
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const logAudit = useApp((s) => s.logAudit)
  const flaggedCases = useApp((s) => s.flaggedCases)
  const flagCandidateCase = useApp((s) => s.flagCandidateCase)
  const addCaseNoteForLeadership = useApp((s) => s.addCaseNoteForLeadership)
  const pushNotification = useApp((s) => s.pushNotification)
  const slaHours = useApp((s) => s.slaHours)
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [routedToLeadership, setRoutedToLeadership] = useState(false)
  const to = emailForCandidate(candidate)
  const subject = 'Welcome to RCPL — Distributor Appointment Confirmed'
  const body = `Dear ${candidate.name} team,\n\nCongratulations — your appointment as an authorized RCPL Staples distributor for ${candidate.town}, Maharashtra is confirmed, effective 3 July 2026.\n\nAttached is your Distributor Appointment Agreement for e-signature — please review and counter-sign at your earliest convenience. Once signed, you'll receive your onboarding kit and RCPL Partner Portal access.\n\nWelcome aboard,\nRCPL Distributor Onboarding Team`

  // Sends a real email over SMTP (same backend/mailer.py path IntakeReview uses to request
  // missing fields) — an official welcome + e-signature request, not just a UI state flip.
  const sendForSignature = async () => {
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/mail/reply', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, subject, text: body }),
      })
      const resBody = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(resBody?.error || `send failed (${res.status})`)
      logAudit({ actor: DEMO_USERS[viewingAs].name, kind: 'human', action: `Sent onboarding welcome + e-signature request to ${to}`, entity: candidate.name })
      setSent(true)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  // Channel Development no longer completes onboarding itself once the e-signature goes out —
  // this routes the case to Leadership for the actual final SM/RBL sign-off (decideCase's
  // becomesActive in store.ts is what activates the candidate), carrying along whatever note
  // Channel Development wants Leadership to see before they approve. The case usually already
  // exists (raised the moment both evaluations cleared — see goAfterEvaluate's
  // raiseLeadershipCase) — this just updates it and adds the note.
  const sendToLeadership = () => {
    const me = DEMO_USERS[viewingAs]
    const existing = flaggedCases.find((c) => c.candidateId === candidate.id && c.ownerRole === 'leadership')
    const caseCode = existing?.code ?? nextCaseCode(flaggedCases, partnerType ?? 'distributor')
    flagCandidateCase({
      code: caseCode,
      partnerName: candidate.name,
      partnerType: partnerType ?? 'distributor',
      town: candidate.town,
      state: 'MH',
      subtype: candidate.subtype ?? 'new',
      status: 'flagged',
      ownerRole: 'channel_dev',
      autoCleared: true,
      slaLabel: slaLabelFromHours(slaHours),
      isOverdue: false,
      hasDiscontinuationForm: candidate.subtype !== 'replacement' || !!candidate.discontinuationForm || (existing?.hasDiscontinuationForm ?? false),
      discontinuationForm: candidate.discontinuationForm ?? existing?.discontinuationForm,
      confidencePct: existing?.confidencePct ?? 96,
      candidateId: candidate.id,
      expectedTurnover: candidate.expectedRcplTurnover,
      flagDetail: 'Financial & Channel Management Evaluation both cleared; e-signature sent — routed to Channel Development for approval.',
      signoffAuthority: authority,
    })
    if (note.trim()) addCaseNoteForLeadership(caseCode, me.name, note.trim())
    pushNotification({
      title: `${caseCode} — awaiting Channel Development approval`,
      body: `${candidate.name} (${candidate.town}) — e-signature sent, routed to Channel Development for approval.`,
      href: '/approvals', forRole: 'channel_dev',
    })
    logAudit({ actor: me.name, kind: 'human', action: `Routed to Channel Development for approval${note.trim() ? ' with a note' : ''}`, entity: caseCode })
    setRoutedToLeadership(true)
    onNext()
  }

  // A clean case (both evaluations passed) still goes to Channel Development for a real
  // approval — see goAfterEvaluate's routeCleanCaseToChannelDev in this file — clearing that
  // activates it straight to IT, no Leadership sign-off on top.
  const existingCase = flaggedCases.find((c) => c.candidateId === candidate.id && c.ownerRole === 'channel_dev' && c.autoCleared)
  const alreadyActive = existingCase?.status === 'approved'

  return (
    <div>
      <div className="agreement-doc">
        <h3 style={{ marginBottom: '0.5rem' }}>Distributor Appointment Agreement</h3>
        <p>This Agreement appoints <strong>{candidate.name}</strong> as an authorized distributor of RCPL Staples products for
          the territory of <strong>{candidate.town}, Maharashtra</strong>, effective <strong>3 July 2026</strong>, subject to
          RCPL's standard distributor terms and the coverage commitment of {candidate.coverageOutlets.toLocaleString()} outlets.</p>
      </div>
      <div className="gate-callout" style={{ background: sent ? 'var(--good-bg)' : 'var(--warn-bg)', borderColor: sent ? '#bfe3d0' : '#f0dcae' }}>
        <span className="flag" style={{ background: sent ? 'var(--good)' : 'var(--warn)' }}>{sent ? 'Sent' : 'Draft'}</span>
        <p style={{ color: sent ? 'var(--good-text)' : 'var(--warn-text)' }}>
          {sent
            ? `Official onboarding welcome + e-signature request sent to ${to} — awaiting counter-signature.`
            : `Not yet sent. Sending will email ${to} the official onboarding welcome and the agreement for e-signature.`}
        </p>
      </div>
      {sendError && <p className="muted-note" style={{ color: 'var(--crit-text)' }}><Icon name="alert" size={12} /> {sendError}</p>}
      {sent && !alreadyActive && (
        <div className="field" style={{ marginTop: '0.9rem' }}>
          <label>Note for Channel Development (optional)</label>
          <p className="muted-note" style={{ marginTop: 0 }}>Anything Channel Development should know before approving — this clean case still needs their sign-off before it goes to IT.</p>
          <textarea className="input" rows={2} placeholder="e.g. e-signature sent, strong auto-clear on both checks…"
            value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
        </div>
      )}
      {sent && alreadyActive && (
        <p className="muted-note" style={{ marginTop: '0.9rem' }}>
          Channel Development already approved this clean case — it's activated and with IT for its DB Code now.
        </p>
      )}
      <div className="wizard-foot">
        <Button variant="text" onClick={onBack}>← Back</Button>
        {!sent
          ? <Button onClick={sendForSignature} disabled={sending}>{sending ? 'Sending…' : 'Send for e-signature →'}</Button>
          : alreadyActive
            ? <Button onClick={onNext}>Continue →</Button>
            : <Button onClick={sendToLeadership} disabled={routedToLeadership}>{routedToLeadership ? 'Sent to Channel Development…' : 'Send to Channel Development for approval →'}</Button>}
      </div>
    </div>
  )
}

/* ---------- Step 7: success ---------- */
function SuccessStep({ candidate, isReplacement, financePass, channelPass, batchChosen, onRestart }:
  { candidate: CandidateCard; isReplacement: boolean; financePass: boolean; channelPass: boolean; batchChosen: Evaluated[]; onRestart: () => void }) {
  const navigate = useNavigate()
  // A Replacement DB still can't auto-activate without its old DB's Discontinuation Form linked
  // (a compliance gate, not a performance one) — matches goAfterEvaluate's needsDiscontinuation.
  const needsDiscontinuationGate = isReplacement && !candidate.discontinuationForm
  const autoCleared = financePass && channelPass && !needsDiscontinuationGate
  const isBatch = batchChosen.length > 1
  const tally = useMemo(() => {
    const t = ['Recommendation Engine · ranked leads', `Evaluation Agent · scored ${batchChosen.length > 0 ? batchChosen.length : 2} leads`]
    if (!financePass || batchChosen.some((e) => !e.financePass)) t.push('Routing · Finance')
    if (!channelPass || batchChosen.some((e) => !e.channelPass)) t.push('Routing · Trade Marketing')
    const anyClean = (!isBatch && autoCleared) || batchChosen.some((e) => e.financePass && e.channelPass)
    if (anyClean) t.push('Routing · Channel Development (clean-case approval)')
    t.push('Communication Agent · notified ASM')
    return t
  }, [financePass, channelPass, batchChosen, autoCleared, isBatch])

  return (
    <Card padLg>
      <div className="success-box">
        <div className="big-check"><Icon name="approvals" size={30} /></div>
        <h2>{isBatch ? `${batchChosen.length} recommendations submitted` : (autoCleared ? 'Recommendation submitted — routed for approval' : 'Recommendation submitted — routed for review')}</h2>
        <p>
          {isBatch
            ? `${batchChosen.length} leads submitted — each routed based on its evaluation result; auto-cleared ones go to Channel Development for approval, then straight to IT for their DB Code — no Leadership sign-off needed for a clean case.`
            : autoCleared
              ? `${candidate.name}, ${candidate.town} — both evaluations passed with no issues, so it's with Channel Development for approval — clearing that sends it straight to IT for its DB Code, no Leadership sign-off needed.`
              : `${candidate.name}, ${candidate.town} — routed to ${!financePass ? 'Finance' : 'Trade Marketing'}${!financePass && !channelPass ? ' and Trade Marketing' : ''} for review. Your part is done — you'll be notified if they need input.`}
        </p>
        {isBatch ? (
          <div className="dtable-wrap" style={{ margin: '1rem 0', textAlign: 'left' }}>
            <table className="dtable">
              <thead><tr><th>Lead</th><th>Town</th><th>Financial</th><th>Channel</th><th>Status</th></tr></thead>
              <tbody>
                {batchChosen.map((e) => {
                  const rowNeedsDiscontinuation = e.c.subtype === 'replacement' && !e.c.discontinuationForm
                  const rowClean = e.financePass && e.channelPass && !rowNeedsDiscontinuation
                  return (
                    <tr key={e.c.id}>
                      <td className="strong">{e.c.name}</td>
                      <td>{e.c.town}</td>
                      <td><Pill tone={e.financePass ? 'good' : 'crit'} dot>{e.fin}%</Pill></td>
                      <td><Pill tone={e.channelPass ? 'good' : 'warn'} dot>{e.infra.toFixed(1)}/10</Pill></td>
                      <td><Pill tone={rowClean ? 'good' : 'warn'}>
                        {rowClean ? '→ Trade Marketing (approval)' : !e.financePass ? '→ Finance' : !e.channelPass ? '→ Trade Marketing' : '→ Trade Marketing (discontinuation)'}
                      </Pill></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="success-meta">
            <div><div className="k">Town</div><div className="v">{candidate.town}</div></div>
            <div><div className="k">Type</div><div className="v">{isReplacement ? 'Replacement' : 'New DB'}</div></div>
            <div><div className="k">Status</div><div className="v">{autoCleared ? 'With Channel Development for approval' : 'In review'}</div></div>
          </div>
        )}
        <div className="agent-tally">{tally.map((t) => <span className="t" key={t}>✦ {t}</span>)}</div>
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', marginTop: '1.2rem' }}>
          <Button variant="ghost" onClick={onRestart}>Start another</Button>
          <Button onClick={() => navigate('/analytics')}>View analytics →</Button>
        </div>
      </div>
    </Card>
  )
}

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AnalyticsSection, Availability, CandidateCard, CandidateStage, CaseMessage, CaseRecord, DataEntity, DataScope, DisengagementForm, OnboardingCase, Partner, PartnerTypeCode, RoleCode, Scenario, ScoutCandidate, ScoutingCase, User, WorkbasketItem } from './types'
import { TEAM_BY_ID, memberName, PRIMARY_USER_BY_ROLE } from './mock/team'
import { assignSeedCases, backupFor, deriveCaseState, isOpenCase, managerOf, pickAssignee } from './lib/assignment'
import { makeEvent, canTransition, stateLabel, START_STATE } from './lib/caseEngine'
import { addWorkingDays } from './lib/workingDays'
import { INITIAL_SCOUTING, MAX_ADVANCE } from './mock/scouting'
import { INITIAL_WORKBASKET } from './mock/workbasket'
import { nextWorkStatus } from './lib/workbasket'
import { INITIAL_ONBOARDING } from './mock/onboardingCases'
import { DEFAULT_DATA_SCOPE_BY_ROLE, DEFAULT_DATA_ENTITIES_BY_ROLE, DEFAULT_ANALYTICS_SECTIONS_BY_ROLE, DEMO_USERS } from './mock/roles'
import { DEMO_PARTNERS, QUEUE_CASES } from './mock/cases'
import type { CopilotAgent } from './lib/copilot'
import { INITIAL_USERS } from './mock/personas'
import { DB_TYPES, DEFAULT_INFRA, meanInfra, requiredInvestmentFor, SCORED_INFRA_KEYS } from './mock/onboarding'
import type { InfraState } from './mock/onboarding'
import { INITIAL_GRIEVANCES } from './mock/grievances'
import { EXTRACTIONS } from './mock/intake'
import type { RequiredDoc, Extraction } from './mock/intake'
import type { Grievance, GrievanceStatus } from './mock/grievances'
import { INITIAL_THREADS } from './mock/communication'
import type { Thread } from './mock/communication'
import { INITIAL_NOTIFICATIONS } from './mock/notifications'
import type { AppNotification } from './mock/notifications'
import { INITIAL_AUDIT } from './mock/audit'
import type { AuditEntry } from './mock/audit'
import { MODULES_BY_ROLE } from './components/shell/nav'

// Formats the configurable SLA window (My Settings) into the "<n>h left" / "<n>d left" label
// Dashboard's SlaTimer already parses — days once the window is a whole multiple of 24h.
export function slaLabelFromHours(hours: number): string {
  return hours > 0 && hours % 24 === 0 ? `${hours / 24}d left` : `${hours}h left`
}

// Bridge a completed DB-Pool item into a lead the ASM can push into New Application. The workbasket
// item carries no evaluation numbers, so we derive plausible, deterministic values from the DB name
// (no Math.random) — enough for the prototype's downstream comparison/appointment flow.
function leadFromWorkbasketDb(it: WorkbasketItem): CandidateCard {
  const seed = it.dbName.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const tierBase = it.companyTier === 'Tier 1' ? 8 : it.companyTier === 'Tier 2' ? 6.5 : 5
  const infraScore = Math.min(10, Math.round((tierBase + (seed % 16) / 10) * 10) / 10)
  const finEvalPct = 70 + (seed % 31)       // 70–100%
  const turnoverMonthly = 30 + (seed % 90)  // ₹30–120L
  // Real per-factor infra scores (not 8 identical sliders) that genuinely average to infraScore,
  // and a real Own Funds/CC Limit split that genuinely sums to finEvalPct — see mock/candidates.ts'
  // deriveInfraFactors/deriveFinance for the same reasoning applied to the directory-lead picker.
  // Only the 7 SCORED_INFRA_KEYS are forced to sum to infraScore — Reputation is generated too
  // (for a non-blank slider) but isn't counted in the average, so it's never adjusted.
  const base = Math.round(infraScore)
  const factorVals = SCORED_INFRA_KEYS.map((_, i) => Math.max(1, Math.min(10, base + (((seed + i * 7) % 5) - 2))))
  factorVals[factorVals.length - 1] = Math.max(1, Math.min(10,
    factorVals[factorVals.length - 1] + (Math.round(infraScore * SCORED_INFRA_KEYS.length) - factorVals.reduce((a, b) => a + b, 0))))
  const reputation = Math.max(1, Math.min(10, base + (seed % 5) - 2))
  const infraFactors = { ...Object.fromEntries(SCORED_INFRA_KEYS.map((k, i) => [k, factorVals[i]])), reputation }
  const expectedRcplTurnover = Math.round(turnoverMonthly * 0.4)
  const financeTotal = Math.round((finEvalPct / 100) * requiredInvestmentFor(turnoverMonthly, expectedRcplTurnover))
  const ownShare = 0.5 + (seed % 30) / 100
  const ownFunds = Math.max(0, Math.min(200, Math.round(financeTotal * ownShare)))
  const ccLimit = Math.max(0, Math.min(150, financeTotal - ownFunds))
  return {
    id: `lead-${it.id}`,
    name: it.dbName,
    town: it.town,
    // Must be one of DB_TYPES — a made-up string here (e.g. the old 'GT DB') silently breaks
    // New Application's category filter/compare-lock, since those compare dbCategory by exact
    // string match. Every DB scouted through the workbasket is a GT DB.
    dbCategory: DB_TYPES[0],
    turnoverMonthly,
    expectedRcplTurnover,
    coverageOutlets: 200 + (seed % 800),
    infraScore,
    finEvalPct,
    infraFactors, ownFunds, ccLimit,
    stage: 'open',
    confidencePct: Math.min(98, Math.round(infraScore * 5 + finEvalPct / 2)),
    userCreated: true,
    createdBy: TEAM_BY_ID[it.ownerId ?? it.shortlistedByAseId]?.roleCode ?? 'ase_asm',
    createdById: it.ownerId ?? it.shortlistedByAseId,
    createdAt: Date.now(),
    subtype: 'new',
  }
}

// Next case code for a newly-flagged candidate — matches the CMP-#### / VND-#### convention
// used by every seeded case, instead of leaking the candidate's internal id into the code.
export function nextCaseCode(existing: CaseRecord[], partnerType: PartnerTypeCode): string {
  const prefix = partnerType === 'vendor' ? 'VND' : 'CMP'
  const base = prefix === 'VND' ? 417 : 2291
  const nums = existing
    .map((c) => c.code)
    .filter((code) => code.startsWith(`${prefix}-`))
    .map((code) => parseInt(code.slice(prefix.length + 1), 10))
    .filter((n) => !isNaN(n))
  const next = (nums.length ? Math.max(...nums) : base) + 1
  return `${prefix}-${String(next).padStart(4, '0')}`
}

// Backs the session with the Python auth service's `.session-store.json` file (backend/,
// `uvicorn main:app --port 8788`) when it's running, so work survives a browser storage reset —
// not just localStorage. Falls back to localStorage alone (the old behavior) if the backend is
// down. Session storage lives alongside auth in that one backend rather than the Node server, so
// all server-side "memory" for the app is in a single place.
const sessionFileStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const res = await fetch('/session')
      if (res.ok) {
        const text = await res.text()
        if (text) return text
      }
    } catch { /* backend not running */ }
    return localStorage.getItem(name)
  },
  setItem: async (name: string, value: string): Promise<void> => {
    localStorage.setItem(name, value)
    try { await fetch('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: value }) }
    catch { /* backend not running */ }
  },
  removeItem: async (name: string): Promise<void> => {
    localStorage.removeItem(name)
    try { await fetch('/session', { method: 'DELETE' }) } catch { /* backend not running */ }
  },
}

// A candidate that clears its final Leadership sign-off — OR auto-clears straight through the
// wizard without ever being flagged — gets a real, live Partner record here, keyed by candidateId
// (not name+town) so it never collides with/overwrites an unrelated seeded partner that happens
// to share a name (e.g. a discontinued distributor being replaced by a new one of the same trade
// name). Calling this again for the same candidate just re-marks it active. Takes the narrow shape
// both CaseRecord (the flagged-case path) and a plain candidate/partnerType pair (the auto-clear
// path, which never creates a CaseRecord at all) already satisfy structurally.
// Next DB Code for a freshly onboarded distributor — one past whatever's already in the
// directory, so a partner onboarded live can itself be looked up as an "OLD DB Code" the next
// time someone replaces it.
function nextDbCode(partners: Partner[]): string {
  const nums = partners.map((p) => parseInt(p.dbCode?.replace(/^DB-/, '') ?? '', 10)).filter((n) => !isNaN(n))
  return `DB-${(nums.length ? Math.max(...nums) : 1000) + 1}`
}

// Seeded demo cases (mock/cases.ts) never carry a candidateId — they were hand-authored as
// already-in-flight cases with no backing live CandidateCard. Falling back to the case's own
// `code` here means approving one of THOSE still yields a real, stable Partner id instead of every
// such case colliding on the literal string "candidate:undefined". But some seeded cases (e.g.
// CMP-2265/CMP-2312, ingested alongside their OWN already-onboarded seed Partner row — p15/p16)
// already have a real partner by name+town+state; matching that first avoids minting a duplicate
// partner (with a second, wrong DB Code) for a distributor that's already fully onboarded.
function partnerIdFor(partners: Partner[], c: { candidateId?: string; code?: string; partnerName: string; town: string; state: string }): string {
  if (c.candidateId) return `candidate:${c.candidateId}`
  const existing = partners.find((p) => p.legalName === c.partnerName && p.town === c.town && p.state === c.state)
  return existing ? existing.id : `case:${c.code}`
}
// The onboarding case that hands a newly-activated DB straight to IT — shared by decideCase
// (Leadership's manual sign-off), autoActivateCase (a clean case skipping sign-off entirely) and
// the v23 migration backfill, so the three activation paths can never drift out of sync.
function buildOnboardingCase(partners: Partner[], target: { code: string; partnerName: string; town: string; state: string; candidateId?: string }, actorName: string): OnboardingCase {
  return {
    id: `onb-${target.code}`, code: `ONB-${target.code.replace(/^[A-Z]+-/, '')}`,
    partnerName: target.partnerName, town: target.town, state: target.state,
    ownerRole: 'it', assigneeId: PRIMARY_USER_BY_ROLE.it,
    caseState: 'APPOINTMENT', startAt: Date.now(),
    parentCaseCode: target.code, candidateId: target.candidateId, partnerId: partnerIdFor(partners, target),
    events: [makeEvent({ kind: 'created', actor: actorName, summary: `Onboarding opened for ${target.partnerName} — sent to IT for DB Code creation (D+2)` })],
  }
}
function upsertActivePartner(partners: Partner[], c: { candidateId?: string; code?: string; partnerName: string; partnerType: PartnerTypeCode; state: string; town: string }): Partner[] {
  const id = partnerIdFor(partners, c)
  // dbCode is intentionally left unset here — IT assigns it once the onboarding case reaches
  // the Appointment stage (createDbCode above), not automatically on activation.
  return partners.some((p) => p.id === id)
    ? partners.map((p) => (p.id === id ? { ...p, status: 'active' } : p))
    : [...partners, {
      id, legalName: c.partnerName, partnerType: c.partnerType, state: c.state, town: c.town, status: 'active', onboardedAt: dateStamp(),
    }]
}

export interface ReportItem { id: string; name: string; date: string; format: string }
const INITIAL_REPORTS: ReportItem[] = [
  { id: 'rep1', name: 'Q2 Coverage & Approval Summary', date: '1 Jul 2026', format: 'PDF' },
  { id: 'rep2', name: 'June appointments by state', date: '30 Jun 2026', format: 'Excel' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// "6 Jul, 14:30" — matches the audit log's existing timestamp style.
const auditStamp = () => {
  const d = new Date()
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
// "6 Jul 2026" — matches the Reports list style.
const dateStamp = () => {
  const d = new Date()
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

interface AppState {
  // session / auth — real login against the Python auth service (backend/, proxied at /auth).
  // roleCode/authUser both come from the server's JWT-backed response, not a client-side pick.
  roleCode: RoleCode | null
  authToken: string | null
  authUser: User | null
  login: (payload: { token: string; user: User }) => void
  logout: () => void

  // persona switcher ("viewing as") — defaults to the logged-in role
  viewingAs: RoleCode | null
  setViewingAs: (role: RoleCode) => void

  // demo scenario
  scenario: Scenario
  setScenario: (s: Scenario) => void

  // working New Application case
  selectedPartnerType: PartnerTypeCode | null
  setSelectedPartnerType: (t: PartnerTypeCode | null) => void
  isReplacement: boolean
  setIsReplacement: (v: boolean) => void

  // copilot dock
  copilotOpen: boolean
  copilotAgent: CopilotAgent
  toggleCopilot: () => void
  setCopilotOpen: (v: boolean) => void
  setCopilotAgent: (a: CopilotAgent) => void
  // a question queued from another screen — the dock opens, asks it, then clears it
  copilotAsk: string | null
  askCopilot: (q: string) => void
  clearCopilotAsk: () => void

  // persona / user directory (admin-managed, mock — no backend)
  users: User[]
  addUser: (u: Omit<User, 'id'>) => void
  updateUser: (id: string, patch: Partial<Omit<User, 'id'>>) => void
  removeUser: (id: string) => void

  // which sidebar screens each persona can see (Admin > Screen access) — seeded from
  // nav.ts's MODULES_BY_ROLE, then admin-editable per role from there on
  moduleAccess: Record<RoleCode, string[]>
  toggleModuleAccess: (role: RoleCode, path: string) => void
  // bulk-replace a persona's visible screens — used when a user's per-screen "View" toggles
  // are saved from Admin > Team, so the sidebar (which is keyed by persona, not by
  // individual login) actually reflects what was just unticked
  setModuleAccessForRole: (role: RoleCode, paths: string[]) => void

  // Data-level (row) access per persona — 'all' vs 'own_region', set by the Super Admin from
  // Admin > Data access. Enforced wherever a record carries a `state` (Partners, GTM Coverage).
  dataScopeByRole: Record<RoleCode, DataScope>
  setDataScopeForRole: (role: RoleCode, scope: DataScope) => void
  // Which data-bearing screens that scope actually applies to, per persona — lets the Super
  // Admin scope a persona on Partners but leave GTM Coverage unrestricted, or vice versa.
  dataEntitiesByRole: Record<RoleCode, DataEntity[]>
  toggleDataEntity: (role: RoleCode, entity: DataEntity) => void
  // Which of Analytics' own tabs (Overview / Distributor Detail / Onboarding Efficiency) a
  // persona can see at all — finer-grained than dataEntitiesByRole's whole-screen toggle.
  analyticsSectionsByRole: Record<RoleCode, AnalyticsSection[]>
  toggleAnalyticsSection: (role: RoleCode, section: AnalyticsSection) => void

  // Partner directory (Manage > Partners) — seeded with the mock roster; a candidate that clears
  // Leadership sign-off gets added here for real instead of vanishing from the app once approved.
  partners: Partner[]
  removePartner: (id: string) => void

  // candidate pipeline — shared between the Candidate Pipeline screen and New Application,
  // so a candidate scored/advanced in one place is reflected in the other.
  candidates: CandidateCard[]
  selectedCandidateId: string
  setSelectedCandidateId: (id: string) => void
  moveCandidate: (id: string, stage: CandidateStage) => void
  // Persists a live edit to ONE candidate's own Channel/Financial evaluation — the per-factor
  // infra scores and the real Own Funds/CC Limit split, plus their derived averages (infraScore,
  // finEvalPct) kept in lockstep. Without this, editing the sliders for whichever candidate is
  // "active" in New Application never actually saved anywhere — switching away and back (or
  // reloading) silently discarded the edit and fell back to a flat, fabricated reconstruction.
  updateCandidateEvaluation: (id: string, patch: { infraFactors?: Record<string, number>; ownFunds?: number; ccLimit?: number }) => void
  // Moves a candidate to 'active' AND creates/upserts its real Partner directory record in one
  // step — unlike plain moveCandidate(id, 'active'), which only ever flipped the candidate's own
  // stage. Use this (not moveCandidate) for every path that completes onboarding — otherwise the
  // candidate shows as onboarded but never actually appears in Partners.
  activateCandidate: (id: string, info: { partnerName: string; partnerType: PartnerTypeCode; town: string; state: string }) => void
  addCandidate: () => void
  removeCandidate: (id: string) => void
  // Non-destructive reject — moves the lead to the 'rejected' stage instead of deleting it, so
  // it stays visible on Leads (unlike removeCandidate, which drops it entirely).
  rejectCandidate: (id: string) => void
  // Sends a rejected lead back to New Application by resetting it to 'open' — re-entering the
  // wizard re-scores it from scratch rather than resuming mid-flight.
  reinstateCandidate: (id: string) => void
  evaluateCandidate: (c: CandidateCard) => void
  setCandidateDiscForm: (id: string, form: DisengagementForm) => void
  // Leads ticked for side-by-side comparison. Lives in the store (not wizard-local state) so the
  // shortlist an ASE/ASM builds from intake is the same one Channel Development opens and compares.
  evalIds: string[]
  setEvalIds: (ids: string[]) => void
  toggleEvalId: (id: string) => void
  // add a lead to the pipeline AND the comparison shortlist (idempotent) — used by intake review
  shortlistCandidate: (c: CandidateCard) => void
  // Attach/replace a supporting document straight from the Leads screen (not routed through
  // Intake Review) — persisted on the candidate itself, same {name, dataUrl} shape Approvals'
  // bank-statement upload already uses for cases.
  setCandidateDoc: (candidateId: string, docKey: string, fileName: string, dataUrl?: string) => void
  // intake items already reviewed & converted to a lead — hidden from the Intake Inbox
  processedIntakeIds: string[]
  markIntakeProcessed: (id: string) => void
  // Explicitly deleted intake items — a SEEDED item (one of the base demo emails/uploads, part
  // of EXTRACTIONS' initial object literal) has no "manualExtractions" entry to remove; deleting
  // it only clears EXTRACTIONS for the current session, and the seed re-creates it on the next
  // reload unless its id is tombstoned here too. Runtime-created items (already removed from
  // manualExtractions on delete) get tombstoned as well, which is harmless and just as permanent.
  deletedIntakeIds: string[]
  markIntakeDeleted: (id: string) => void
  // EXTRACTIONS (mock/intake.ts) is a plain in-memory object, not persisted — a document actually
  // uploaded/replaced from Intake Review would otherwise vanish on the next page reload. Keyed by
  // intake id, then required-doc name, holding the real replacement (with its own dataUrl).
  intakeDocOverrides: Record<string, Record<string, RequiredDoc>>
  setIntakeDocOverride: (intakeId: string, doc: RequiredDoc) => void
  // A brand-new intake row (Excel import, manual Create Lead form, or pasted/uploaded email
  // text) writes straight into EXTRACTIONS — a plain in-memory object with NO base seed entry
  // for it, unlike intakeDocOverrides above which only overrides a doc on an EXISTING seeded
  // entry. Without this, that new row simply doesn't exist anymore after a reload. Keyed by
  // intake id; merged back into EXTRACTIONS once at store rehydration (see mergeManualExtractions
  // in mock/intake.ts) and kept in sync on every add/remove.
  manualExtractions: Record<string, Extraction>
  addManualExtraction: (ext: Extraction) => void
  removeManualExtraction: (id: string) => void
  infra: InfraState
  setInfra: (s: InfraState) => void
  ownFunds: number
  setOwnFunds: (n: number) => void
  ccLimit: number
  setCcLimit: (n: number) => void

  // The Approvals queue — seeded with the mock demo cases, plus real entries the New
  // Application wizard raises when a candidate is actually flagged to Finance/Channel
  // Development, so a flagged candidate shows up where the owning team can act on it
  // (previously the wizard's review screens never wrote anywhere Approvals could see).
  flaggedCases: CaseRecord[]
  flagCandidateCase: (c: CaseRecord) => void
  decideCase: (code: string, decision: 'approved' | 'rejected', actorName?: string) => void
  // Channel Development (or Finance) found an issue that needs the field team's own fix — not a
  // full rejection. Reverts ownership to ase_asm and the candidate to 'open' so it's back in
  // Leads/New Application for them to correct and resubmit, rather than just a comment thread
  // (see requestInfoFromAsm, which leaves the case owned by the reviewer).
  sendCaseBackToAsm: (code: string, note: string, actorName?: string) => void
  // Records an actual document upload against a case's financial-verification checklist item
  // (or the channel coverage-plan gate) — persisted on the case record itself so the gate
  // survives navigating away and back, and so bulk-approve can see it too.
  uploadCaseFinanceDoc: (code: string, key: string, fileName: string, dataUrl?: string) => void
  uploadCaseChannelDoc: (code: string, fileName: string) => void
  // Persists a note for Leadership on the case itself (in addition to the one-time
  // notification) so it's actually readable once the case reaches their queue, not just
  // a terse audit-log line saying a note was sent.
  addCaseNoteForLeadership: (code: string, author: string, body: string) => void
  markOnboardingNotified: (code: string) => void

  // ── Assignment engine (workflow-assignment-engine) ──
  // Per-person availability overrides (leave / on-duty), layered over the TEAM roster seed.
  availabilityByUser: Record<string, Availability>
  // Set a person's duty state. Going on leave auto-reassigns their open cases to a backup /
  // the next on-duty peer; coming back is a no-op on already-moved work.
  setAvailability: (userId: string, availability: Availability, actorName?: string) => void
  // Assign / reassign a specific case to a specific person (appends a timeline event + audit + notify).
  assignCase: (code: string, userId: string, actorName?: string) => void
  reassignCase: (code: string, userId: string, actorName?: string, reason?: string) => void
  // Push a case up the manager ladder (ASE → ASM → SM → RBL) — used on SLA breach or manually.
  // Returns who it escalated to (name + level), or null if there was no manager above.
  escalateCase: (code: string, actorName?: string, reason?: string) => string | null
  // Sweep open cases; any that have breached their SLA (and weren't escalated yet) are
  // auto-escalated up the manager chain, notified, and timelined. Returns how many escalated.
  checkSlaBreaches: (now?: number) => number

  // ── Scouting cases (db-scouting, slide 4) ──
  scoutingCases: ScoutingCase[]
  // Serve a 30-day termination notice on an existing DB → opens a scouting case with Day D = today
  // and starts the 7-working-day clock. Returns the new case id.
  serveTerminationNotice: (input: { partnerName?: string; area: string; state: string; townClass?: ScoutingCase['townClass']; reason?: string }, actorName?: string) => string
  // Add a candidate to a scouting case's register (the ASE's market list).
  addScoutCandidate: (caseId: string, cand: { name: string; town: string; companyTier: ScoutCandidate['companyTier']; competingBrand: boolean }) => void
  advanceScouting: (id: string, toState: string, actorName?: string) => void
  updateScoutCandidate: (caseId: string, candId: string, patch: Partial<ScoutCandidate>) => void
  // Hand off the advanced (≤3) candidates to the appointment stage as real leads; returns the count.
  handOffScouting: (caseId: string, actorName?: string) => number

  // ── Workbasket / worklist (db-workbasket) ──
  // Shared pool of every DB the ASEs have shortlisted. An ASM picks items into their worklist;
  // the RBL supervisor assigns the leftovers. Ownership is per-person (ownerId), same as cases.
  workbasket: WorkbasketItem[]
  // ASM claims an unclaimed item → moves into their worklist (status 'picked', claimedVia 'pick').
  pickWorkbasketItem: (id: string, userId: string, actorName?: string) => void
  // RBL hands an unclaimed item to an ASM (status 'assigned', claimedVia 'assigned'); notifies them.
  assignWorkbasketItem: (id: string, toUserId: string, actorName?: string) => void
  // Bulk variant — assign many unclaimed items to one ASM in a single update (one notify + audit).
  assignWorkbasketItems: (ids: string[], toUserId: string, actorName?: string) => void
  // Move an already-owned item to a different owner (manual rebalance / on-leave handoff).
  reassignWorkbasketItem: (id: string, toUserId: string, actorName?: string, reason?: string) => void
  // Bulk-clear every item currently owned by one ASE/ASM back to 'unclaimed' — no destination
  // picked here; the supervisor decides who each one goes to afterward from the Unassigned tab
  // (same assign flow every other unclaimed DB already goes through).
  unassignWorkbasketItemsByOwner: (ownerId: string, actorName?: string) => void
  // Advance an owned item along picked/assigned → in_progress → done.
  advanceWorkbasketItem: (id: string, actorName?: string) => void
  // Owner/supervisor flags (or clears) an item that needs attention (e.g. owner on leave/issue).
  flagWorkbasketItem: (id: string, note: string, actorName?: string) => void
  unflagWorkbasketItem: (id: string, actorName?: string) => void

  // ── Onboarding cases (onboarding-training, slides 5 & 8, collapsed to Appointment + Complete) ──
  onboardingCases: OnboardingCase[]
  // IT creates the DB Code for the onboarding case's partner while it's still in the Appointment
  // stage — a no-op once the code already exists or the case has moved past Appointment. This is
  // the only step; it takes the case straight to Complete.
  createDbCode: (onboardingId: string, actorName?: string) => void
  // Advance a case to a new workflow state through the transition engine (validates legality,
  // appends a timeline event, mirrors to audit, and light-syncs the legacy status on terminals).
  applyTransition: (code: string, toState: string, actorName?: string) => boolean

  // per-ASE/ASM inbox configuration (My Settings page) — the Intake Agent watches this mailbox
  inboxProvider: 'gmail' | 'outlook' | null
  inboxAddress: string
  connectInbox: (provider: 'gmail' | 'outlook', address: string) => void
  disconnectInbox: () => void
  autoForwardUnmatched: boolean
  setAutoForwardUnmatched: (v: boolean) => void
  // per-ASE/ASM SLA review window (My Settings page) — how long a newly flagged/routed
  // case gets before it's counted overdue; drives the slaLabel stamped on new cases.
  slaHours: number
  setSlaHours: (h: number) => void
  // Day-based SLA configuration (deck slides 4 & 7) — working days, anchored to Day D.
  slaConfig: { scoutingDays: number; itCodeDays: number; approvalDays: number }
  setSlaConfig: (patch: Partial<AppState['slaConfig']>) => void

  // distributor grievances (Grievances module + surfaced on the DB 360° profile)
  grievances: Grievance[]
  setGrievanceStatus: (id: string, status: GrievanceStatus) => void
  // marks a grievance in progress and emails the distributor a holding reply — lands in
  // Communication as a partner-facing thread keyed by the grievance id
  sendGrievanceUpdate: (id: string) => void

  // case/partner communication — shared so any screen (Approvals, Partners, Distributor profile)
  // can nudge a partner or open a thread and land on it in Communication.
  commThreads: Thread[]
  selectedThreadCode: string
  setSelectedThreadCode: (code: string) => void
  sendCommMessage: (code: string, msg: CaseMessage) => void
  nudgePartner: (input: { code: string; town: string; partnerName: string; reason: string }) => void

  // topbar notifications bell
  notifications: AppNotification[]
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void
  pushNotification: (n: { title: string; body: string; href: string; forRole?: RoleCode }) => void

  // live audit trail — appended to by real actions (approvals, onboarding, exports)
  auditLog: AuditEntry[]
  logAudit: (e: { actor: string; kind: AuditEntry['kind']; action: string; entity: string }) => void

  // shareable reports (Leadership export/share)
  reports: ReportItem[]
  addReport: (r: { name: string; format: string }) => void

  // open (creating if needed) the internal case-discussion thread and select it
  openCaseDiscussion: (input: { code: string; town: string; partnerName: string }) => void
  // a reviewer requests info from the ASM: posts to the case thread, notifies, logs the audit trail
  requestInfoFromAsm: (input: { code: string; town: string; partnerName: string; reviewerRole: RoleCode; reviewerName: string; note: string }) => void
}

export const useApp = create<AppState>()(persist((set) => ({
  roleCode: null,
  authToken: null,
  authUser: null,
  login: ({ token, user }) => set({ roleCode: user.roleCode, viewingAs: user.roleCode, authToken: token, authUser: user }),
  logout: () => set({ roleCode: null, viewingAs: null, authToken: null, authUser: null, copilotOpen: false }),

  viewingAs: null,
  setViewingAs: (role) => set({ viewingAs: role }),

  scenario: 'flagged',
  setScenario: (s) => set({ scenario: s }),

  selectedPartnerType: null,
  setSelectedPartnerType: (t) => set({ selectedPartnerType: t }),
  isReplacement: false,
  setIsReplacement: (v) => set({ isReplacement: v }),

  copilotOpen: false,
  copilotAgent: 'general',
  toggleCopilot: () => set((s) => ({ copilotOpen: !s.copilotOpen })),
  setCopilotOpen: (v) => set({ copilotOpen: v }),
  setCopilotAgent: (a) => set({ copilotAgent: a }),
  copilotAsk: null,
  askCopilot: (q) => set({ copilotOpen: true, copilotAsk: q }),
  clearCopilotAsk: () => set({ copilotAsk: null }),

  users: INITIAL_USERS,
  addUser: (u) => set((s) => ({ users: [...s.users, { ...u, id: `u${Date.now()}` }] })),
  updateUser: (id, patch) => set((s) => ({
    users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
  })),
  removeUser: (id) => set((s) => ({ users: s.users.filter((u) => u.id !== id) })),

  moduleAccess: Object.fromEntries(
    Object.entries(MODULES_BY_ROLE).map(([role, paths]) => [role, [...paths]]),
  ) as Record<RoleCode, string[]>,
  toggleModuleAccess: (role, path) => set((s) => {
    const current = s.moduleAccess[role] ?? []
    const has = current.includes(path)
    return {
      moduleAccess: {
        ...s.moduleAccess,
        [role]: has ? current.filter((p) => p !== path) : [...current, path],
      },
    }
  }),
  setModuleAccessForRole: (role, paths) => set((s) => ({
    moduleAccess: { ...s.moduleAccess, [role]: Array.from(new Set(paths)) },
  })),

  dataScopeByRole: { ...DEFAULT_DATA_SCOPE_BY_ROLE },
  setDataScopeForRole: (role, scope) => set((s) => ({
    dataScopeByRole: { ...s.dataScopeByRole, [role]: scope },
  })),

  dataEntitiesByRole: Object.fromEntries(
    Object.entries(DEFAULT_DATA_ENTITIES_BY_ROLE).map(([role, entities]) => [role, [...entities]]),
  ) as Record<RoleCode, DataEntity[]>,
  toggleDataEntity: (role, entity) => set((s) => {
    const current = s.dataEntitiesByRole[role] ?? []
    const has = current.includes(entity)
    return { dataEntitiesByRole: { ...s.dataEntitiesByRole, [role]: has ? current.filter((e) => e !== entity) : [...current, entity] } }
  }),

  analyticsSectionsByRole: Object.fromEntries(
    Object.entries(DEFAULT_ANALYTICS_SECTIONS_BY_ROLE).map(([role, sections]) => [role, [...sections]]),
  ) as Record<RoleCode, AnalyticsSection[]>,
  toggleAnalyticsSection: (role, section) => set((s) => {
    const current = s.analyticsSectionsByRole[role] ?? []
    const has = current.includes(section)
    return { analyticsSectionsByRole: { ...s.analyticsSectionsByRole, [role]: has ? current.filter((x) => x !== section) : [...current, section] } }
  }),

  partners: DEMO_PARTNERS,
  removePartner: (id) => set((s) => ({ partners: s.partners.filter((p) => p.id !== id) })),

  // The pipeline starts empty — Trade Marketing pulls in the leads the field team created
  // & shortlisted on the Leads page; nothing is pre-seeded.
  candidates: [],
  selectedCandidateId: '',
  setSelectedCandidateId: (id) => set({ selectedCandidateId: id }),
  moveCandidate: (id, stage) => set((s) => ({ candidates: s.candidates.map((c) => (c.id === id ? { ...c, stage } : c)) })),
  updateCandidateEvaluation: (id, patch) => set((s) => ({
    candidates: s.candidates.map((c) => {
      if (c.id !== id) return c
      const infraFactors = patch.infraFactors ?? c.infraFactors
      const ownFunds = patch.ownFunds ?? c.ownFunds
      const ccLimit = patch.ccLimit ?? c.ccLimit
      return {
        ...c, ...patch,
        infraScore: infraFactors ? meanInfra(infraFactors) : c.infraScore,
        finEvalPct: (ownFunds != null && ccLimit != null) ? Math.round(((ownFunds + ccLimit) / requiredInvestmentFor(c.turnoverMonthly, c.expectedRcplTurnover)) * 100) : c.finEvalPct,
      }
    }),
  })),
  activateCandidate: (id, info) => set((s) => ({
    candidates: s.candidates.map((c) => (c.id === id ? { ...c, stage: 'active' } : c)),
    partners: upsertActivePartner(s.partners, { candidateId: id, ...info }),
  })),
  addCandidate: () => set((s) => ({
    candidates: [...s.candidates, {
      id: `c${s.candidates.length + 1}-${s.candidates.length}`, name: `New candidate ${s.candidates.length + 1}`, town: 'Nashik',
      dbCategory: 'GT DB (with CSO/DSM)', turnoverMonthly: 100, expectedRcplTurnover: 20, coverageOutlets: 500,
      infraScore: 5, finEvalPct: 70, stage: 'open', confidencePct: 50,
    }],
  })),
  removeCandidate: (id) => set((s) => {
    const candidates = s.candidates.filter((c) => c.id !== id)
    return {
      candidates,
      selectedCandidateId: s.selectedCandidateId === id ? (candidates[0]?.id ?? '') : s.selectedCandidateId,
      evalIds: s.evalIds.filter((x) => x !== id),
    }
  }),
  // Rejecting a lead at Evaluation no longer deletes it — it drops out of the comparison
  // shortlist (evalIds) and out of the active wizard selection, but the candidate itself stays
  // on Leads with a 'rejected' stage so it isn't silently lost.
  rejectCandidate: (id) => set((s) => ({
    candidates: s.candidates.map((c) => (c.id === id ? { ...c, stage: 'rejected' } : c)),
    evalIds: s.evalIds.filter((x) => x !== id),
    selectedCandidateId: s.selectedCandidateId === id ? '' : s.selectedCandidateId,
  })),
  reinstateCandidate: (id) => set((s) => ({
    candidates: s.candidates.map((c) => (c.id === id ? { ...c, stage: 'open' } : c)),
  })),
  setCandidateDiscForm: (id, form) => set((s) => ({
    candidates: s.candidates.map((c) => (c.id === id ? { ...c, discontinuationForm: form } : c)),
  })),
  // Pulls a distributor from Leads into the pipeline for scoring (adds it if new, just selects it if already there).
  evaluateCandidate: (c) => set((s) => ({
    candidates: s.candidates.some((x) => x.id === c.id) ? s.candidates : [...s.candidates, c],
    selectedCandidateId: c.id,
  })),
  evalIds: [],
  setEvalIds: (ids) => set({ evalIds: ids }),
  toggleEvalId: (id) => set((s) => ({
    evalIds: s.evalIds.includes(id) ? s.evalIds.filter((x) => x !== id) : [...s.evalIds, id],
  })),
  // Re-reviewing the same firm (its id is a slug of the name, so a second Excel upload/manual
  // entry for "Mountain Peak Traders" always lands on the SAME id) used to silently no-op here —
  // the corrected numbers from the second upload were discarded with no error, leaving whoever's
  // reviewing it staring at stale data from the first attempt with no idea why. Now it updates
  // the existing record with the freshly reviewed data, while preserving `documents` and not
  // regressing `stage` backward — a lead already routed past Evaluate shouldn't reset to 'open'
  // just because someone re-reviewed its intake.
  shortlistCandidate: (c) => set((s) => {
    const existing = s.candidates.find((x) => x.id === c.id)
    const candidates = existing
      ? s.candidates.map((x) => (x.id === c.id
        ? { ...x, ...c, documents: x.documents ?? c.documents, stage: x.stage === 'open' ? c.stage : x.stage }
        : x))
      : [...s.candidates, c]
    return {
      candidates,
      selectedCandidateId: c.id,
      evalIds: s.evalIds.includes(c.id) ? s.evalIds : [...s.evalIds, c.id],
    }
  }),
  setCandidateDoc: (candidateId, docKey, fileName, dataUrl) => set((s) => ({
    candidates: s.candidates.map((c) => (c.id === candidateId
      ? { ...c, documents: { ...c.documents, [docKey]: { name: fileName, dataUrl } } }
      : c)),
  })),
  processedIntakeIds: [],
  markIntakeProcessed: (id) => set((s) => ({
    processedIntakeIds: s.processedIntakeIds.includes(id) ? s.processedIntakeIds : [...s.processedIntakeIds, id],
  })),
  deletedIntakeIds: [],
  markIntakeDeleted: (id) => set((s) => ({
    deletedIntakeIds: s.deletedIntakeIds.includes(id) ? s.deletedIntakeIds : [...s.deletedIntakeIds, id],
  })),
  intakeDocOverrides: {},
  setIntakeDocOverride: (intakeId, doc) => set((s) => ({
    intakeDocOverrides: { ...s.intakeDocOverrides, [intakeId]: { ...s.intakeDocOverrides[intakeId], [doc.name]: doc } },
  })),
  manualExtractions: {},
  addManualExtraction: (ext) => set((s) => ({ manualExtractions: { ...s.manualExtractions, [ext.id]: ext } })),
  removeManualExtraction: (id) => set((s) => {
    const { [id]: _removed, ...rest } = s.manualExtractions
    return { manualExtractions: rest }
  }),
  infra: { ...DEFAULT_INFRA },
  setInfra: (s) => set({ infra: s }),
  ownFunds: 120,
  setOwnFunds: (n) => set({ ownFunds: n }),
  ccLimit: 80,
  setCcLimit: (n) => set({ ccLimit: n }),

  // Seed the queue with a person-level assignee per case (territory + round-robin), so the
  // My Work view and the on-leave reassignment behaviour have real assignments to act on.
  flaggedCases: assignSeedCases(QUEUE_CASES),
  // Upsert by candidateId + ownerRole (falling back to code for the hand-seeded QUEUE_CASES
  // rows, which carry no candidateId): NewApplication.tsx mints a FRESH case code via
  // nextCaseCode() on every call, so deduping by code alone never matches and a candidate
  // re-entering the same review step (e.g. navigating back and forward through the wizard)
  // would otherwise raise a brand-new duplicate case each time instead of updating the one
  // already raised for them. Matching on candidateId ALONE (dropping ownerRole) was wrong: a
  // candidate that fails BOTH Finance and Channel Development needs two separate sibling
  // cases (see decideCase's siblingStillOpen below) — matching by candidateId alone made the
  // second team's flagCandidateCase call silently overwrite the first team's case instead of
  // creating its own, so the second team never got a case in their queue at all.
  flagCandidateCase: (c) => set((s) => {
    const matches = (x: CaseRecord) => (c.candidateId ? x.candidateId === c.candidateId && x.ownerRole === c.ownerRole : x.code === c.code)
    if (s.flaggedCases.some(matches)) {
      // Re-raise of an existing case: refresh its detail but keep its case-management fields
      // (workflow state, assignee, timeline) — those belong to the live case, not the payload.
      return {
        flaggedCases: s.flaggedCases.map((x) => (matches(x)
          ? { ...x, ...c, code: x.code, caseState: x.caseState, assigneeId: x.assigneeId, events: x.events,
              involvedRoles: [...new Set([...(x.involvedRoles ?? [x.ownerRole]), c.ownerRole])] }
          : x)),
      }
    }
    // New case: stamp it onto the case-management spine — type, workflow state, a person assignee
    // (territory + round-robin), and a first timeline event mirrored to the audit log.
    const withCase: CaseRecord = { ...c, caseType: c.caseType ?? 'appointment', involvedRoles: [c.ownerRole] }
    // Per-case SLA clock: anchored to now (this case's Day D), due after the configured review window.
    if (withCase.slaAnchorAt == null) withCase.slaAnchorAt = Date.now()
    if (withCase.slaDueAt == null) withCase.slaDueAt = withCase.slaAnchorAt + s.slaHours * 3600e3
    // Banded sign-off authority from the real expected turnover (deck slide 7): > ₹50L → RBL, else SM.
    if (withCase.expectedTurnover != null) withCase.signoffAuthority = withCase.expectedTurnover > 50 ? 'RBL' : 'SM'
    withCase.caseState = c.caseState ?? deriveCaseState(withCase)
    withCase.assigneeId = c.assigneeId ?? pickAssignee({ role: c.ownerRole, state: c.state, cases: s.flaggedCases, overrides: s.availabilityByUser })
    withCase.events = [makeEvent({ kind: 'created', actor: 'Recommendation Engine',
      summary: `Case opened — ${stateLabel(withCase.caseState)}${withCase.assigneeId ? `, assigned to ${memberName(withCase.assigneeId)}` : ''}` })]
    return {
      flaggedCases: [withCase, ...s.flaggedCases],
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: 'Routing Agent', kind: 'ai', action: `Opened case ${withCase.code} — ${stateLabel(withCase.caseState)}`, entity: withCase.code }, ...s.auditLog],
    }
  }),
  // Approval ladder (L1 → L2 → L3). The field team (ASE/ASM, L1) only SUBMITS — it never gives
  // final approval, even for a clean case: a clean case is routed straight to Leadership (L3).
  // When a case flags on financial/infra grounds, the relevant L2 team (Finance / Channel
  // Development) reviews it first and, on clearing, hands it UP to Leadership (L3). ONLY
  // Leadership's approval ACTIVATES the DB (creates the Partner record + spawns onboarding).
  decideCase: (code, decision, actorName = 'Reviewer') => set((s) => {
    const target = s.flaggedCases.find((c) => c.code === code)
    if (!target) return {}
    const roleLabel = (r: RoleCode) => r.replace('_', ' ')
    // Append a transition event to the case's timeline and move its workflow state in lockstep
    // with the decision — so caseState, status and the timeline are one truth, not three.
    const withEvent = (c: CaseRecord, patch: Partial<CaseRecord>, ev: ReturnType<typeof makeEvent>): CaseRecord =>
      ({ ...c, ...patch, events: [...(c.events ?? []), ev] })
    if (decision === 'rejected') {
      const ev = makeEvent({ kind: 'rejected', actor: actorName, summary: `Rejected by ${roleLabel(target.ownerRole)}`, fromState: target.caseState, toState: 'REJECTED' })
      return { flaggedCases: s.flaggedCases.map((c) => (c.code === code ? withEvent(c, { status: 'rejected', caseState: 'REJECTED' }, ev) : c)) }
    }
    const siblingStillOpen = target.candidateId
      ? s.flaggedCases.some((c) =>
          c.candidateId === target.candidateId && c.code !== code && c.status === 'flagged'
          && (c.ownerRole === 'finance' || c.ownerRole === 'channel_dev'))
      : false
    const isReviewTeam = target.ownerRole === 'finance' || target.ownerRole === 'channel_dev'
    const isLeadership = target.ownerRole === 'leadership'
    // A case that auto-cleared (both evaluations passed, no issues) still sits with Channel
    // Development for a real approval — it just doesn't need Leadership on top of that once
    // Channel Dev clears it; Channel Dev's own approval is what activates it straight to IT.
    const cleanFastTrack = isReviewTeam && !!target.autoCleared
    // An L2 team clearing while its sibling check is still open → this one just PARKS (approved)
    // and waits; it doesn't advance on its own.
    const parked = isReviewTeam && siblingStillOpen && !cleanFastTrack
    // Leadership (L3) always activates. Channel Dev clearing a clean (autoCleared) case also
    // activates directly — no Leadership needed for those. Every other approval — an L2 team
    // clearing a genuinely-flagged check, or the ASM on a clean case pre-Channel-Dev — routes the
    // case UP to Leadership for the final sign-off.
    // Seeded demo cases (mock/cases.ts) never carry a candidateId — they were hand-authored as
    // already-in-flight cases with no backing CandidateCard — so this used to require one and
    // silently dead-ended every seeded case at "approved" with no partner, no onboarding, and
    // nothing for IT to ever see. partnerIdFor's case-code fallback (below) is what makes
    // activating one of these safe now.
    const becomesActive = isLeadership || (cleanFastTrack && !parked)
    const routesToLeadership = !isLeadership && !parked && !cleanFastTrack

    const patch: Partial<CaseRecord> = becomesActive
      ? { status: 'approved', caseState: 'ACTIVE' }
      : routesToLeadership
        ? { status: 'flagged', ownerRole: 'leadership', caseState: 'LEADERSHIP_SIGNOFF',
            involvedRoles: [...new Set([...(target.involvedRoles ?? [target.ownerRole]), 'leadership' as RoleCode])] }
        : { status: 'approved', caseState: 'UNDER_REVIEW' } // parked — awaiting the sibling evaluation
    const summary = becomesActive
      ? (isLeadership ? 'Approved by Leadership (L3) — final sign-off, partner activated'
          : `${roleLabel(target.ownerRole)} approved the clean case — partner activated, sent to IT for DB Code`)
      : routesToLeadership
        ? (isReviewTeam
            ? `${roleLabel(target.ownerRole)} (L2) cleared — routed to Leadership (L3) for final sign-off`
            : 'Recommendation cleared — routed to Leadership (L3) for final sign-off')
        : `${roleLabel(target.ownerRole)} approved — awaiting the other evaluation`
    const ev = makeEvent({ kind: becomesActive ? 'approved' : routesToLeadership ? 'transition' : 'approved',
      actor: actorName, fromState: target.caseState, toState: patch.caseState, summary })

    // Only Leadership's sign-off spawns onboarding + activates the partner.
    const spawnOnboarding = becomesActive && !s.onboardingCases.some((o) => o.parentCaseCode === target.code)
    // Straight to IT once activated — the Appointment stage's whole job at this point is
    // creating the DB Code, so ownership hands off to IT immediately, not to the field team.
    const onboarding: OnboardingCase | null = spawnOnboarding ? buildOnboardingCase(s.partners, target, actorName) : null
    // Ping Leadership whenever a case lands in their L3 queue; ping IT the moment a DB clears and
    // its onboarding case opens, awaiting its DB Code. Trade Marketing (Channel Development) gets
    // a ping too on every activation — even a fully auto-cleared case that never needed their
    // review — so they always have visibility into every DB going active, not just flagged ones.
    const notifications = [
      ...(routesToLeadership
        ? [{ id: `n${Date.now()}`, time: 'just now', read: false, title: `Final sign-off needed — ${target.code}`,
            body: `${target.partnerName} cleared L2 review — awaiting your (L3) approval.`, href: '/approvals', forRole: 'leadership' as RoleCode }]
        : []),
      ...(onboarding
        ? [{ id: `n${Date.now()}-it`, time: 'just now', read: false, title: `DB Code needed — ${onboarding.code}`,
            body: `${target.partnerName} cleared final sign-off — create its DB Code (D+2 SLA).`, href: '/approvals', forRole: 'it' as RoleCode }]
        : []),
      ...(becomesActive
        ? [{ id: `n${Date.now()}-cd`, time: 'just now', read: false, title: `${target.code} activated`,
            body: `${target.partnerName} (${target.town}) is now active — for your visibility.`, href: '/approvals', forRole: 'channel_dev' as RoleCode }]
        : []),
      ...s.notifications,
    ]
    return {
      flaggedCases: s.flaggedCases.map((c) => (c.code === code ? withEvent(c, patch, ev) : c)),
      candidates: becomesActive
        ? s.candidates.map((cd) => (cd.id === target.candidateId ? { ...cd, stage: 'active' } : cd))
        : routesToLeadership
          ? s.candidates.map((cd) => (cd.id === target.candidateId ? { ...cd, stage: 'approval_2' } : cd))
          : s.candidates,
      partners: becomesActive ? upsertActivePartner(s.partners, target) : s.partners,
      onboardingCases: onboarding ? [onboarding, ...s.onboardingCases] : s.onboardingCases,
      notifications,
    }
  }),
  sendCaseBackToAsm: (code, note, actorName = 'Reviewer') => set((s) => {
    const target = s.flaggedCases.find((c) => c.code === code)
    if (!target) return {}
    const roleLabel = target.ownerRole.replace('_', ' ')
    const ev = makeEvent({
      kind: 'transition', actor: actorName, fromState: target.caseState, toState: 'SUBMITTED',
      summary: `Sent back to the field team by ${roleLabel} — ${note}`,
    })
    const flaggedCases = s.flaggedCases.map((c) => (c.code === code
      ? { ...c, status: 'sent_back' as const, ownerRole: 'ase_asm' as RoleCode, caseState: 'SUBMITTED', events: [...(c.events ?? []), ev] }
      : c))
    // Back in the field team's own hands to fix and resubmit — same place a fresh lead sits.
    const candidates = target.candidateId
      ? s.candidates.map((cd) => (cd.id === target.candidateId ? { ...cd, stage: 'open' as const } : cd))
      : s.candidates
    const notifyRole: RoleCode = target.candidateId
      ? (s.candidates.find((cd) => cd.id === target.candidateId)?.createdBy ?? 'ase_asm')
      : 'ase_asm'
    return {
      flaggedCases,
      candidates,
      notifications: [{
        id: `n${Date.now()}`, time: 'just now', read: false, title: `${code} sent back to you`,
        body: `${target.partnerName} (${target.town}) — ${roleLabel} found an issue: ${note}`,
        href: '/approvals', forRole: notifyRole,
      }, ...s.notifications],
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human' as const,
        action: `Sent back to field team (${roleLabel}) — ${note}`, entity: code }, ...s.auditLog],
    }
  }),
  // Both doc uploads write onto every sibling case (same candidateId — see the dual-fail note
  // above addCaseNoteForLeadership), not just the one case code open right now. A dual-fail
  // candidate's Channel Dev case and Finance/Leadership case are separate records; without
  // this, a document uploaded while looking at one case would be invisible on the other,
  // including once ownership hands off to Leadership.
  uploadCaseFinanceDoc: (code, key, fileName, dataUrl) => set((s) => {
    const target = s.flaggedCases.find((c) => c.code === code)
    const matches = (c: CaseRecord) => c.code === code || (!!target?.candidateId && c.candidateId === target.candidateId)
    return {
      flaggedCases: s.flaggedCases.map((c) => (matches(c)
        ? { ...c, financeDocsUploaded: { ...c.financeDocsUploaded, [key]: { name: fileName, dataUrl } } }
        : c)),
    }
  }),
  uploadCaseChannelDoc: (code, fileName) => set((s) => {
    const target = s.flaggedCases.find((c) => c.code === code)
    const matches = (c: CaseRecord) => c.code === code || (!!target?.candidateId && c.candidateId === target.candidateId)
    return { flaggedCases: s.flaggedCases.map((c) => (matches(c) ? { ...c, channelDocUploaded: fileName } : c)) }
  }),
  // A dual-fail candidate has TWO sibling case records (one for Finance, one for Channel
  // Development — see flagCandidateCase's candidateId+ownerRole upsert above), so a note left
  // on one of them has to be written onto BOTH, not just the case the author happened to have
  // open — otherwise the other team's own case record never carries it and they'd never see it.
  addCaseNoteForLeadership: (code, author, body) => set((s) => {
    const note = { author, body, when: auditStamp() }
    const target = s.flaggedCases.find((c) => c.code === code)
    const matches = (c: CaseRecord) => c.code === code || (!!target?.candidateId && c.candidateId === target.candidateId)
    return { flaggedCases: s.flaggedCases.map((c) => (matches(c) ? { ...c, notesForLeadership: [...(c.notesForLeadership ?? []), note] } : c)) }
  }),
  markOnboardingNotified: (code) => set((s) => ({
    flaggedCases: s.flaggedCases.map((c) => (c.code === code ? { ...c, onboardingNotified: true } : c)),
  })),

  // ── Assignment engine ──
  availabilityByUser: {},

  setAvailability: (userId, availability, actorName = 'You') => set((s) => {
    const overrides = { ...s.availabilityByUser, [userId]: availability }
    const audit = [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human' as const,
      action: `Set ${memberName(userId)} to ${availability.status === 'on_leave' ? 'On leave' : 'On duty'}`, entity: 'Team' }, ...s.auditLog]
    // Going on duty just updates the flag (and clears any leave-flags on this person's worklist
    // DBs). Going on leave hands off this person's open cases and flags their worklist DBs.
    if (availability.status !== 'on_leave') {
      const workbasket = s.workbasket.map((it) => (it.ownerId === userId && it.flagged && it.flagNote?.includes('on leave')
        ? { ...it, flagged: false, flagNote: undefined, events: [...it.events, makeEvent({ kind: 'note', actor: actorName, summary: `Flag cleared — ${memberName(userId)} back on duty` })] }
        : it))
      return { availabilityByUser: overrides, auditLog: audit, workbasket }
    }
    const notifications = [...s.notifications]
    const mine = s.flaggedCases.filter((c) => c.assigneeId === userId && isOpenCase(c))
    let cases = s.flaggedCases
    // Delegation of cases is a supervisor's call — a field ASE never has their work handed off
    // automatically. Their open cases stay put and the RBL is notified to reassign them.
    const leavePerson = TEAM_BY_ID[userId]
    const isFieldAse = leavePerson?.roleCode === 'ase_asm' && leavePerson?.level === 'ASE'
    if (isFieldAse) {
      if (mine.length) {
        const ev = makeEvent({ kind: 'note', actor: actorName,
          summary: `${memberName(userId)} on leave — awaiting supervisor reassignment`, at: Date.now() })
        cases = cases.map((x) => (mine.some((m) => m.code === x.code) ? { ...x, events: [...(x.events ?? []), ev] } : x))
        notifications.unshift({ id: `n${Date.now()}-leave`, time: 'just now', read: false,
          title: `${memberName(userId)} on leave — ${mine.length} case${mine.length > 1 ? 's' : ''} to reassign`,
          body: `Reassign ${memberName(userId)}'s open case${mine.length > 1 ? 's' : ''} to an on-duty ASE.`,
          href: '/approvals', forRole: 'rbl' })
        audit.unshift({ id: `a${Date.now()}-leave`, when: auditStamp(), actor: actorName, kind: 'human',
          action: `${memberName(userId)} on leave — ${mine.length} case(s) flagged for supervisor reassignment`, entity: 'Team' })
      }
    } else {
      for (const c of mine) {
        const to = backupFor(userId, cases, overrides)
        if (!to || to === userId) continue
        const ev = makeEvent({ kind: 'reassigned', actor: actorName,
          summary: `Reassigned from ${memberName(userId)} (on leave) to ${memberName(to)}`, at: Date.now() })
        cases = cases.map((x) => (x.code === c.code
          ? { ...x, assigneeId: to, events: [...(x.events ?? []), ev] } : x))
        notifications.unshift({ id: `n${Date.now()}-${c.code}`, time: 'just now', read: false,
          title: `Case ${c.code} reassigned to you`, body: `${c.partnerName} — handed off while ${memberName(userId)} is on leave.`,
          href: '/approvals', forRole: TEAM_BY_ID[to]?.roleCode })
        audit.unshift({ id: `a${Date.now()}-${c.code}`, when: auditStamp(), actor: actorName, kind: 'human',
          action: `Reassigned ${c.code} to ${memberName(to)} (${memberName(userId)} on leave)`, entity: c.code })
      }
    }
    // Worklist DBs stay OWNED by this person (per the process — assignment doesn't move on its
    // own) but are flagged so the RBL supervisor sees them and can reassign as needed.
    const leaveNote = `${memberName(userId)} on leave`
    const workbasket = s.workbasket.map((it) => (it.ownerId === userId && it.status !== 'done' && !it.flagged
      ? { ...it, flagged: true, flagNote: leaveNote, events: [...it.events, makeEvent({ kind: 'note', actor: actorName, summary: `Flagged — owner ${memberName(userId)} on leave` })] }
      : it))
    return { availabilityByUser: overrides, flaggedCases: cases, notifications, auditLog: audit, workbasket }
  }),

  assignCase: (code, userId, actorName = 'You') => set((s) => {
    const target = s.flaggedCases.find((c) => c.code === code)
    if (!target) return {}
    const ev = makeEvent({ kind: 'assigned', actor: actorName, summary: `Assigned to ${memberName(userId)}` })
    return {
      flaggedCases: s.flaggedCases.map((c) => (c.code === code ? { ...c, assigneeId: userId, events: [...(c.events ?? []), ev] } : c)),
      notifications: [{ id: `n${Date.now()}`, time: 'just now', read: false, title: `Case ${code} assigned to you`,
        body: `${target.partnerName} — ${target.town}.`, href: '/approvals', forRole: TEAM_BY_ID[userId]?.roleCode }, ...s.notifications],
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `Assigned ${code} to ${memberName(userId)}`, entity: code }, ...s.auditLog],
    }
  }),

  reassignCase: (code, userId, actorName = 'You', reason) => set((s) => {
    const target = s.flaggedCases.find((c) => c.code === code)
    if (!target) return {}
    const from = memberName(target.assigneeId)
    const ev = makeEvent({ kind: 'reassigned', actor: actorName,
      summary: `Reassigned from ${from} to ${memberName(userId)}${reason ? ` — ${reason}` : ''}` })
    return {
      flaggedCases: s.flaggedCases.map((c) => (c.code === code ? { ...c, assigneeId: userId, events: [...(c.events ?? []), ev] } : c)),
      notifications: [{ id: `n${Date.now()}`, time: 'just now', read: false, title: `Case ${code} reassigned to you`,
        body: `${target.partnerName} — ${target.town}.`, href: '/approvals', forRole: TEAM_BY_ID[userId]?.roleCode }, ...s.notifications],
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `Reassigned ${code} from ${from} to ${memberName(userId)}`, entity: code }, ...s.auditLog],
    }
  }),

  escalateCase: (code, actorName = 'You', reason) => {
    let escalatedTo: string | null = null
    set((s) => {
      const target = s.flaggedCases.find((c) => c.code === code)
      if (!target) return {}
      const mgr = managerOf(target.assigneeId) ?? managerOf(PRIMARY_USER_BY_ROLE[target.ownerRole])
      if (!mgr) return {}
      escalatedTo = `${mgr.name} (${mgr.level})`
      const ev = makeEvent({ kind: 'escalated', actor: actorName,
        summary: `Escalated to ${mgr.name} (${mgr.level})${reason ? ` — ${reason}` : ''}` })
      return {
        flaggedCases: s.flaggedCases.map((c) => (c.code === code
          ? { ...c, assigneeId: mgr.id, escalated: true, events: [...(c.events ?? []), ev] } : c)),
        notifications: [{ id: `n${Date.now()}`, time: 'just now', read: false, title: `Case ${code} escalated to you`,
          body: `${target.partnerName} — ${reason ?? 'escalated'}.`, href: '/approvals', forRole: mgr.roleCode }, ...s.notifications],
        auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `Escalated ${code} to ${mgr.name} (${mgr.level})`, entity: code }, ...s.auditLog],
      }
    })
    return escalatedTo
  },

  checkSlaBreaches: (now = Date.now()) => {
    let count = 0
    set((s) => {
      const breached = s.flaggedCases.filter((c) =>
        c.status === 'flagged' && isOpenCase(c) && !c.escalated
        && ((c.slaDueAt != null && now > c.slaDueAt) || c.isOverdue === true))
      if (!breached.length) return {}
      let cases = s.flaggedCases
      const notifications = [...s.notifications]
      const audit = [...s.auditLog]
      for (const c of breached) {
        const mgr = managerOf(c.assigneeId) ?? managerOf(PRIMARY_USER_BY_ROLE[c.ownerRole])
        if (!mgr) continue
        count++
        const ev = makeEvent({ kind: 'sla_breach', actor: 'SLA Monitor',
          summary: `SLA breached — auto-escalated to ${mgr.name} (${mgr.level})` })
        cases = cases.map((x) => (x.code === c.code ? { ...x, assigneeId: mgr.id, escalated: true, events: [...(x.events ?? []), ev] } : x))
        notifications.unshift({ id: `n${Date.now()}-${c.code}`, time: 'just now', read: false,
          title: `SLA breached — ${c.code} escalated to you`, body: `${c.partnerName} passed its SLA and was auto-escalated up the chain.`, href: '/approvals', forRole: mgr.roleCode })
        audit.unshift({ id: `a${Date.now()}-${c.code}`, when: auditStamp(), actor: 'SLA Monitor', kind: 'ai',
          action: `SLA breach — auto-escalated ${c.code} to ${mgr.name} (${mgr.level})`, entity: c.code })
      }
      return { flaggedCases: cases, notifications, auditLog: audit }
    })
    return count
  },

  // ── Onboarding ──
  onboardingCases: INITIAL_ONBOARDING,
  createDbCode: (onboardingId, actorName = 'You') => set((s) => {
    const ob = s.onboardingCases.find((x) => x.id === onboardingId)
    if (!ob || ob.caseState !== 'APPOINTMENT') return {}
    const partner = ob.partnerId ? s.partners.find((p) => p.id === ob.partnerId) : undefined
    if (!partner || partner.dbCode) return {}
    const code = nextDbCode(s.partners)
    // DB Code creation is the only real onboarding step — no separate Training/Handholding/
    // Central Induction stages to click through. The case completes immediately and the partner
    // just sits in Partners, DB Code and all.
    const ev = makeEvent({ kind: 'approved', actor: actorName, fromState: 'APPOINTMENT', toState: 'COMPLETE',
      summary: `DB Code ${code} created by IT — onboarding complete` })
    return {
      partners: s.partners.map((p) => (p.id === ob.partnerId ? { ...p, dbCode: code } : p)),
      onboardingCases: s.onboardingCases.map((x) => (x.id === onboardingId ? { ...x, caseState: 'COMPLETE', events: [...x.events, ev] } : x)),
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `${ob.code}: DB Code ${code} created — onboarding complete`, entity: ob.code }, ...s.auditLog],
    }
  }),

  // ── Scouting ──
  scoutingCases: INITIAL_SCOUTING,
  serveTerminationNotice: (input, actorName = 'You') => {
    let id = ''
    set((s) => {
      const nums = s.scoutingCases.map((c) => parseInt(c.code.replace(/^SCT-/, ''), 10)).filter((n) => !isNaN(n))
      const next = (nums.length ? Math.max(...nums) : 4000) + 1
      id = `sct-${next}`
      const dayD = Date.now()
      const sc: ScoutingCase = {
        id, code: `SCT-${next}`, area: input.area, state: input.state,
        townClass: input.townClass ?? 'Up to FLP', reason: input.reason ?? '30-day termination notice',
        ownerRole: 'ase_asm', assigneeId: pickAssignee({ role: 'ase_asm', state: input.state, cases: s.flaggedCases, overrides: s.availabilityByUser }),
        caseState: 'REGISTER', dayD, slaDueAt: addWorkingDays(dayD, s.slaConfig.scoutingDays),
        candidates: [],
        events: [makeEvent({ kind: 'created', actor: actorName, summary: `${input.reason ?? '30-day termination notice'}${input.partnerName ? ` for ${input.partnerName}` : ''} — scouting opened (Day D), ${s.slaConfig.scoutingDays}-working-day SLA started` })],
      }
      return {
        scoutingCases: [sc, ...s.scoutingCases],
        notifications: [{ id: `n${Date.now()}`, time: 'just now', read: false, title: `Scouting opened — ${sc.code}`, body: `${input.area}, ${input.state} — shortlist a replacement within ${s.slaConfig.scoutingDays} working days.`, href: '/intake-inbox', forRole: 'ase_asm' }, ...s.notifications],
        auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `Served termination notice — opened scouting ${sc.code} (${input.area})`, entity: sc.code }, ...s.auditLog],
      }
    })
    return id
  },
  addScoutCandidate: (caseId, cand) => set((s) => ({
    scoutingCases: s.scoutingCases.map((x) => (x.id === caseId
      ? { ...x, candidates: [...x.candidates, { id: `sc-${Date.now()}`, name: cand.name, town: cand.town, companyTier: cand.companyTier, competingBrand: cand.competingBrand, retailerFeedback: [] }] }
      : x)),
  })),
  advanceScouting: (id, toState, actorName = 'You') => set((s) => {
    const sc = s.scoutingCases.find((x) => x.id === id)
    if (!sc || !canTransition('scouting', sc.caseState, toState)) return {}
    const ev = makeEvent({ kind: toState === 'CANCELLED' ? 'rejected' : 'transition', actor: actorName,
      fromState: sc.caseState, toState, summary: `${stateLabel(sc.caseState)} → ${stateLabel(toState)}` })
    return {
      scoutingCases: s.scoutingCases.map((x) => (x.id === id ? { ...x, caseState: toState, events: [...x.events, ev] } : x)),
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `${sc.code}: ${stateLabel(sc.caseState)} → ${stateLabel(toState)}`, entity: sc.code }, ...s.auditLog],
    }
  }),
  updateScoutCandidate: (caseId, candId, patch) => set((s) => ({
    scoutingCases: s.scoutingCases.map((x) => (x.id === caseId
      ? { ...x, candidates: x.candidates.map((c) => (c.id === candId ? { ...c, ...patch } : c)) } : x)),
  })),
  handOffScouting: (caseId, actorName = 'You') => {
    let count = 0
    set((s) => {
      const sc = s.scoutingCases.find((x) => x.id === caseId)
      if (!sc) return {}
      const advancing = sc.candidates.filter((c) => c.advanced).slice(0, MAX_ADVANCE)
      count = advancing.length
      if (!count) return {}
      // Spawn one appointment lead per advanced candidate — the scouting → appointment hand-off.
      const newLeads: CandidateCard[] = advancing.map((c, i): CandidateCard => ({
        id: `scout-${caseId}-${c.id}`, name: c.name, town: c.town, dbCategory: 'GT DB (with CSO/DSM)',
        turnoverMonthly: 150, expectedRcplTurnover: 30, coverageOutlets: 1000, infraScore: 7, finEvalPct: 100,
        stage: 'open', confidencePct: 80, userCreated: true, createdBy: 'ase_asm', createdAt: Date.now() + i, subtype: 'new',
      })).filter((l) => !s.candidates.some((cd) => cd.id === l.id))
      const ev = makeEvent({ kind: 'transition', actor: actorName, fromState: sc.caseState, toState: 'HANDED_OFF',
        summary: `Handed off ${count} candidate${count > 1 ? 's' : ''} to the appointment stage` })
      return {
        scoutingCases: s.scoutingCases.map((x) => (x.id === caseId ? { ...x, caseState: 'HANDED_OFF', events: [...x.events, ev] } : x)),
        candidates: [...newLeads, ...s.candidates],
        notifications: [{ id: `n${Date.now()}`, time: 'just now', read: false, title: `${sc.code} — ${count} candidate${count > 1 ? 's' : ''} handed off`,
          body: `${advancing.map((a) => a.name).join(', ')} moved to the appointment stage (Leads).`, href: '/leads', forRole: 'ase_asm' }, ...s.notifications],
        auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `${sc.code}: handed off ${count} candidate(s) to appointment`, entity: sc.code }, ...s.auditLog],
      }
    })
    return count
  },

  // ── Workbasket / worklist ──
  workbasket: INITIAL_WORKBASKET,
  pickWorkbasketItem: (id, userId, actorName = 'You') => set((s) => {
    const it = s.workbasket.find((x) => x.id === id)
    if (!it || it.status !== 'unclaimed') return {}
    const ev = makeEvent({ kind: 'assigned', actor: actorName, summary: `Picked into ${memberName(userId)}'s worklist` })
    return {
      workbasket: s.workbasket.map((x) => (x.id === id
        ? { ...x, status: 'picked', ownerId: userId, claimedVia: 'pick', claimedAt: Date.now(), events: [...x.events, ev] } : x)),
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `Picked ${it.dbName} into worklist`, entity: it.id }, ...s.auditLog],
    }
  }),
  assignWorkbasketItem: (id, toUserId, actorName = 'You') => set((s) => {
    const it = s.workbasket.find((x) => x.id === id)
    if (!it || it.status !== 'unclaimed') return {}
    const ev = makeEvent({ kind: 'assigned', actor: actorName, summary: `Assigned to ${memberName(toUserId)} by ${actorName} (RBL)` })
    return {
      workbasket: s.workbasket.map((x) => (x.id === id
        ? { ...x, status: 'assigned', ownerId: toUserId, claimedVia: 'assigned', assignedById: PRIMARY_USER_BY_ROLE.rbl, claimedAt: Date.now(), events: [...x.events, ev] } : x)),
      notifications: [{ id: `n${Date.now()}`, time: 'just now', read: false, title: 'DB assigned to you',
        body: `${it.dbName} — ${it.town}, ${it.state}. Assigned by ${actorName}.`, href: '/leads', forRole: TEAM_BY_ID[toUserId]?.roleCode }, ...s.notifications],
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `Assigned ${it.dbName} to ${memberName(toUserId)}`, entity: it.id }, ...s.auditLog],
    }
  }),
  assignWorkbasketItems: (ids, toUserId, actorName = 'You') => set((s) => {
    const idset = new Set(ids)
    let count = 0
    const now = Date.now()
    const workbasket = s.workbasket.map((it) => {
      if (!idset.has(it.id) || it.status !== 'unclaimed') return it
      count++
      const ev = makeEvent({ kind: 'assigned', actor: actorName, summary: `Assigned to ${memberName(toUserId)} by ${actorName} (RBL) — bulk assignment` })
      return { ...it, status: 'assigned' as const, ownerId: toUserId, claimedVia: 'assigned' as const, assignedById: PRIMARY_USER_BY_ROLE.rbl, claimedAt: now, events: [...it.events, ev] }
    })
    if (!count) return {}
    return {
      workbasket,
      notifications: [{ id: `n${now}`, time: 'just now', read: false, title: `${count} DB${count > 1 ? 's' : ''} assigned to you`,
        body: `${count} shortlisted DB${count > 1 ? 's were' : ' was'} assigned to you by ${actorName}.`, href: '/leads', forRole: TEAM_BY_ID[toUserId]?.roleCode }, ...s.notifications],
      auditLog: [{ id: `a${now}`, when: auditStamp(), actor: actorName, kind: 'human', action: `Bulk-assigned ${count} DB${count > 1 ? 's' : ''} to ${memberName(toUserId)}`, entity: 'DB Pool' }, ...s.auditLog],
    }
  }),
  reassignWorkbasketItem: (id, toUserId, actorName = 'You', reason) => set((s) => {
    const it = s.workbasket.find((x) => x.id === id)
    if (!it) return {}
    const from = memberName(it.ownerId)
    const ev = makeEvent({ kind: 'reassigned', actor: actorName, summary: `Reassigned from ${from} to ${memberName(toUserId)}${reason ? ` — ${reason}` : ''}` })
    return {
      workbasket: s.workbasket.map((x) => (x.id === id
        ? { ...x, ownerId: toUserId, status: x.status === 'unclaimed' ? 'assigned' : x.status, flagged: false, flagNote: undefined, events: [...x.events, ev] } : x)),
      notifications: [{ id: `n${Date.now()}`, time: 'just now', read: false, title: 'DB reassigned to you',
        body: `${it.dbName} — ${it.town}, ${it.state}.`, href: '/leads', forRole: TEAM_BY_ID[toUserId]?.roleCode }, ...s.notifications],
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `Reassigned ${it.dbName} from ${from} to ${memberName(toUserId)}`, entity: it.id }, ...s.auditLog],
    }
  }),
  unassignWorkbasketItemsByOwner: (ownerId, actorName = 'You') => set((s) => {
    const ownerName = memberName(ownerId)
    let count = 0
    const now = Date.now()
    const workbasket = s.workbasket.map((it) => {
      if (it.ownerId !== ownerId) return it
      count++
      const ev = makeEvent({ kind: 'reassigned', actor: actorName, summary: `Unassigned from ${ownerName} — back in the pool` })
      return { ...it, status: 'unclaimed' as const, ownerId: undefined, claimedVia: undefined, claimedAt: undefined, assignedById: undefined, flagged: false, flagNote: undefined, events: [...it.events, ev] }
    })
    if (!count) return {}
    return {
      workbasket,
      auditLog: [{ id: `a${now}`, when: auditStamp(), actor: actorName, kind: 'human', action: `Unassigned ${count} DB${count > 1 ? 's' : ''} from ${ownerName}`, entity: 'DB Pool' }, ...s.auditLog],
    }
  }),
  advanceWorkbasketItem: (id, actorName = 'You') => set((s) => {
    const it = s.workbasket.find((x) => x.id === id)
    if (!it) return {}
    const to = nextWorkStatus(it.status)
    if (!to) return {}
    const ev = makeEvent({ kind: to === 'done' ? 'approved' : 'transition', actor: actorName,
      summary: to === 'done' ? 'Marked done' : 'Started work — handed to the ASM as a lead' })
    const workbasket = s.workbasket.map((x) => (x.id === id ? { ...x, status: to, events: [...x.events, ev] } : x))
    const audit = [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human' as const, action: `${it.dbName}: ${to === 'done' ? 'marked done' : 'in progress'}`, entity: it.id }, ...s.auditLog]
    // Bridge: an ASE STARTING work on a DB (not just finishing it) is what surfaces it as a lead
    // the ASM can pick up in New Application — the ASM shouldn't have to wait for the ASE to
    // mark it fully done before they can start reviewing/submitting it themselves.
    if ((to === 'in_progress' || to === 'done') && !s.candidates.some((c) => c.id === `lead-${it.id}`)) {
      return {
        workbasket,
        candidates: [leadFromWorkbasketDb(it), ...s.candidates],
        notifications: [{ id: `n${Date.now()}-lead`, time: 'just now', read: false,
          title: `New lead ready — ${it.dbName}`,
          body: `${memberName(it.ownerId ?? it.shortlistedByAseId)} started work on this DB. Review and submit it in New Application.`,
          href: '/leads', forRole: 'asm' as const }, ...s.notifications],
        auditLog: [{ id: `a${Date.now()}-lead`, when: auditStamp(), actor: actorName, kind: 'human' as const,
          action: `Lead created from DB ${it.dbName}`, entity: it.id }, ...audit],
      }
    }
    return { workbasket, auditLog: audit }
  }),
  flagWorkbasketItem: (id, note, actorName = 'You') => set((s) => {
    const it = s.workbasket.find((x) => x.id === id)
    if (!it) return {}
    const ev = makeEvent({ kind: 'note', actor: actorName, summary: `Flagged — ${note}` })
    return {
      workbasket: s.workbasket.map((x) => (x.id === id ? { ...x, flagged: true, flagNote: note, events: [...x.events, ev] } : x)),
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `Flagged ${it.dbName} — ${note}`, entity: it.id }, ...s.auditLog],
    }
  }),
  unflagWorkbasketItem: (id, actorName = 'You') => set((s) => {
    const it = s.workbasket.find((x) => x.id === id)
    if (!it) return {}
    const ev = makeEvent({ kind: 'note', actor: actorName, summary: 'Flag cleared' })
    return { workbasket: s.workbasket.map((x) => (x.id === id ? { ...x, flagged: false, flagNote: undefined, events: [...x.events, ev] } : x)) }
  }),

  applyTransition: (code, toState, actorName = 'You') => {
    let ok = false
    set((s) => {
      const c = s.flaggedCases.find((x) => x.code === code)
      if (!c) return {}
      const type = c.caseType ?? 'appointment'
      const from = c.caseState ?? START_STATE[type] ?? ''
      if (!canTransition(type, from, toState)) return {}
      ok = true
      const kind = toState === 'REJECTED' ? 'rejected'
        : (toState === 'BILLING' || toState === 'COMPLETE' || toState === 'HANDED_OFF') ? 'approved' : 'transition'
      const ev = makeEvent({ kind, actor: actorName, summary: `${stateLabel(from)} → ${stateLabel(toState)}`, fromState: from, toState })
      // Keep the legacy status roughly in step on terminals so the rest of the app stays consistent.
      const status = toState === 'REJECTED' ? 'rejected' : (toState === 'BILLING' || toState === 'COMPLETE') ? 'approved' : c.status
      return {
        flaggedCases: s.flaggedCases.map((x) => (x.code === code ? { ...x, caseState: toState, status, events: [...(x.events ?? []), ev] } : x)),
        auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: actorName, kind: 'human', action: `${code}: ${stateLabel(from)} → ${stateLabel(toState)}`, entity: code }, ...s.auditLog],
      }
    })
    return ok
  },

  inboxProvider: 'outlook',
  inboxAddress: 'rmalhotra@rcpl-field.in',
  connectInbox: (provider, address) => set({ inboxProvider: provider, inboxAddress: address }),
  disconnectInbox: () => set({ inboxProvider: null }),
  autoForwardUnmatched: true,
  setAutoForwardUnmatched: (v) => set({ autoForwardUnmatched: v }),
  slaHours: 24,
  setSlaHours: (h) => set({ slaHours: h }),
  slaConfig: { scoutingDays: 7, itCodeDays: 2, approvalDays: 0 },
  setSlaConfig: (patch) => set((s) => ({ slaConfig: { ...s.slaConfig, ...patch } })),

  grievances: INITIAL_GRIEVANCES,
  setGrievanceStatus: (id, status) => set((s) => ({
    grievances: s.grievances.map((g) => {
      if (g.id !== id || g.status === status) return g
      const label = status === 'open' ? 'Reopened' : status === 'in_progress' ? 'Marked in progress' : 'Resolved'
      return {
        ...g,
        status,
        slaLabel: status === 'resolved' ? 'Closed' : g.slaLabel,
        isOverdue: status === 'resolved' ? false : g.isOverdue,
        updates: [...g.updates, { on: '04 Jul 2026', by: 'You', note: `${label} from the Grievances queue.` }],
      }
    }),
  })),
  sendGrievanceUpdate: (id) => set((s) => {
    const g = s.grievances.find((x) => x.id === id)
    if (!g) return {}
    const holdingReply = 'Our team is actively looking into it and will get back to you once the review is complete.'
    const grievances = s.grievances.map((x) => (x.id === id
      ? {
          ...x,
          status: (x.status === 'open' ? 'in_progress' : x.status) as GrievanceStatus,
          updates: [...x.updates, { on: dateStamp(), by: 'You', note: `Emailed distributor: "${holdingReply}"` }],
        }
      : x))
    const msg: CaseMessage = { id: `grv-${Date.now()}`, authorRole: g.ownerRole, authorName: 'You', body: holdingReply }
    const exists = s.commThreads.some((t) => t.code === g.id)
    const commThreads = exists
      ? s.commThreads.map((t) => (t.code === g.id
          ? { ...t, audience: 'partner' as const, last: holdingReply, participants: [...t.participants, msg] }
          : t))
      : [...s.commThreads, { code: g.id, town: g.town, partnerName: g.distributor, audience: 'partner' as const, participants: [msg], last: holdingReply }]
    return {
      grievances,
      commThreads,
      selectedThreadCode: g.id,
      notifications: [{ id: `n${Date.now()}`, time: 'just now', read: false, title: 'Distributor emailed', body: `${g.distributor} was sent a holding reply on ${g.id}.`, href: '/grievances', forRole: g.ownerRole }, ...s.notifications],
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: 'You', kind: 'human' as const, action: 'Emailed distributor a holding reply', entity: g.id }, ...s.auditLog],
    }
  }),

  commThreads: INITIAL_THREADS,
  selectedThreadCode: INITIAL_THREADS[0].code,
  setSelectedThreadCode: (code) => set({ selectedThreadCode: code }),
  sendCommMessage: (code, msg) => set((s) => ({
    commThreads: s.commThreads.map((t) => (t.code === code
      ? { ...t, last: msg.body, participants: [...t.participants.map((m) => ({ ...m, isNextReplier: false })), msg] }
      : t)),
  })),
  // Opens (or creates) a partner-facing thread and drops in an outbound nudge — usable from
  // any screen that has case/partner context (Approvals, Partners, Distributor profile).
  nudgePartner: ({ code, town, partnerName, reason }) => set((s) => {
    const msg: CaseMessage = { id: `nudge-${Date.now()}`, authorRole: 'ase_asm', authorName: 'You', body: reason }
    const exists = s.commThreads.some((t) => t.code === code)
    const commThreads = exists
      ? s.commThreads.map((t) => (t.code === code
          ? { ...t, audience: 'partner' as const, last: reason, participants: [...t.participants, msg] }
          : t))
      : [...s.commThreads, { code, town, partnerName, audience: 'partner' as const, participants: [msg], last: reason }]
    return { commThreads, selectedThreadCode: code }
  }),

  notifications: INITIAL_NOTIFICATIONS,
  markNotificationRead: (id) => set((s) => ({
    notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
  })),
  markAllNotificationsRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
  pushNotification: (n) => set((s) => ({
    notifications: [{ id: `n${Date.now()}`, time: 'just now', read: false, ...n }, ...s.notifications],
  })),

  auditLog: INITIAL_AUDIT,
  logAudit: (e) => set((s) => ({ auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), ...e }, ...s.auditLog] })),

  reports: INITIAL_REPORTS,
  addReport: (r) => set((s) => ({ reports: [{ id: `r${Date.now()}`, date: dateStamp(), ...r }, ...s.reports] })),

  openCaseDiscussion: ({ code, town, partnerName }) => set((s) => {
    if (s.commThreads.some((t) => t.code === code)) return { selectedThreadCode: code }
    const seed: CaseMessage = { id: `seed-${Date.now()}`, authorRole: 'ase_asm', authorName: 'R. Malhotra', body: `Opened the case thread for ${partnerName}.` }
    return {
      commThreads: [...s.commThreads, { code, town, partnerName, audience: 'internal' as const, participants: [seed], last: seed.body }],
      selectedThreadCode: code,
    }
  }),

  requestInfoFromAsm: ({ code, town, partnerName, reviewerRole, reviewerName, note }) => set((s) => {
    const msg: CaseMessage = { id: `req-${Date.now()}`, authorRole: reviewerRole, authorName: reviewerName, body: note }
    const exists = s.commThreads.some((t) => t.code === code)
    const commThreads = exists
      ? s.commThreads.map((t) => (t.code === code
          ? { ...t, audience: 'internal' as const, last: note, participants: [...t.participants.map((m) => ({ ...m, isNextReplier: false })), msg] }
          : t))
      : [...s.commThreads, { code, town, partnerName, audience: 'internal' as const, participants: [msg], last: note }]
    return {
      commThreads,
      selectedThreadCode: code,
      notifications: [{ id: `n${Date.now()}`, title: `Info requested on ${code}`, body: `${partnerName} — ${reviewerName} needs more information. Reply in the case thread.`, href: '/communication', time: 'just now', read: false }, ...s.notifications],
      auditLog: [{ id: `a${Date.now()}`, when: auditStamp(), actor: reviewerName, kind: 'human' as const, action: 'Requested info from ASM', entity: code }, ...s.auditLog],
    }
  }),
}), {
  name: 'rcpl-session',
  storage: createJSONStorage(() => sessionFileStorage),
  // Persist auth/session-identity plus the lead pipeline & comparison shortlist — leads an
  // ASE/ASM creates from Intake Review must survive reloads and persona switches so they stay
  // visible on Leads and to Channel Development. Everything else resets to its mock seed.
  partialize: (s) => ({
    roleCode: s.roleCode, viewingAs: s.viewingAs, authToken: s.authToken, authUser: s.authUser, scenario: s.scenario,
    candidates: s.candidates, selectedCandidateId: s.selectedCandidateId, evalIds: s.evalIds,
    processedIntakeIds: s.processedIntakeIds, notifications: s.notifications, auditLog: s.auditLog,
    flaggedCases: s.flaggedCases, partners: s.partners, slaHours: s.slaHours, slaConfig: s.slaConfig,
    intakeDocOverrides: s.intakeDocOverrides, availabilityByUser: s.availabilityByUser,
    scoutingCases: s.scoutingCases, onboardingCases: s.onboardingCases, workbasket: s.workbasket,
    manualExtractions: s.manualExtractions, deletedIntakeIds: s.deletedIntakeIds,
    // Admin & Settings' own edits — users (incl. per-user screen permissions like the Manage
    // toggle), per-role sidebar visibility, and per-role data-scope/entity/analytics settings.
    // Missing from here means every Admin & Settings change reverts on the next page reload.
    users: s.users, moduleAccess: s.moduleAccess, dataScopeByRole: s.dataScopeByRole,
    dataEntitiesByRole: s.dataEntitiesByRole, analyticsSectionsByRole: s.analyticsSectionsByRole,
  }),
  // A brand-new intake row (Excel import / manual Create Lead / pasted email) has no seed entry
  // in EXTRACTIONS to merge an override onto — the whole Extraction has to come back, not just a
  // diff. Recorded in manualExtractions above; merged back into the live EXTRACTIONS object here,
  // once, as soon as rehydration completes (storage is async — see sessionFileStorage).
  onRehydrateStorage: () => (state) => {
    if (state?.manualExtractions) Object.assign(EXTRACTIONS, state.manualExtractions)
    // Applied AFTER merging manualExtractions back in — a tombstoned id should stay gone even
    // if it also happens to be a runtime-created one merged the line above.
    if (state?.deletedIntakeIds) state.deletedIntakeIds.forEach((id) => { delete EXTRACTIONS[id] })
  },
  // v7: the Kolhapur intake email's replacement candidate was seeded with the SAME name as the
  // unrelated, already-discontinued "Ganesh Distributors" seed partner (p4) — once the candidate
  // went active it showed up as a confusing second "Ganesh Distributors" row. Renamed the seed
  // intake data to "Ganpati Distributors"; rename it in any session that already created this
  // candidate/case/partner under the old, colliding name.
  // v8: sessions saved right around the v7 rollout got persisted already stamped `version: 7`
  // but from BEFORE this rename migration existed, so it never actually ran for them — bump to
  // 8 to force it to run once more (the rename logic itself is unchanged and idempotent).
  // v9: new demo cases/partners added to the seed data (mock/cases.ts) after a session was
  // already persisted never showed up for that session — flaggedCases already self-heals this
  // way (any QUEUE_CASES code not already carried over gets appended below), but `partners` was
  // only ever backfilled from DEMO_PARTNERS when totally absent. Added the same catch-up merge
  // for partners, and bumped the version so already-persisted sessions actually pick it up.
  // v10: appending missing partners (v9) doesn't help the ones already persisted — every partner
  // saved before `onboardedAt`/`discontinuedAt` existed on the Partner type is still missing them,
  // so Analytics' Partner Aging renders empty for any session older than those fields. Backfill
  // both fields from the current DEMO_PARTNERS seed (matched by id) whenever a persisted partner
  // doesn't already have them.
  // v11: same v7/v8 problem again — sessions saved right around the v10 rollout got persisted
  // already stamped `version: 10` but from before the onboardedAt/discontinuedAt backfill above
  // actually ran, so Partner Aging still only shows the handful of partners created after that
  // point (the 3 newest demo-scenario ones) instead of the full, realistically-aged roster. Bump
  // to 11 to force the same (unchanged, idempotent) backfill to run once more for them.
  // v12: mock/cases.ts's seed data (QUEUE_CASES, DEMO_PARTNERS) was replaced wholesale from the
  // ingested RCPL_Distributor_Onboarding_Dataset.xlsx — flaggedCases already self-heals on every
  // migrate (seed-owned cases, i.e. no candidateId, are dropped and rebuilt from QUEUE_CASES), but
  // partners was only ever appended-to by id (v9), never resynced, so a persisted seed partner
  // (e.g. p6/p10) kept showing its pre-ingestion legalName/status forever. Seed ids (`p#`) are
  // never mutated by the app itself — only `candidate:${id}` rows are — so it's safe to fully
  // resync every already-persisted seed-id partner from the current DEMO_PARTNERS row.
  // v13: financeDocsUploaded's values changed shape from a plain filename string to
  // `{ name, dataUrl }` (so Approvals can show the reviewer's real uploaded file instead of
  // always falling back to a synthetic mock PDF) — a session persisted before this rollout
  // still has the old string, which reads back as `undefined.name`/`undefined.dataUrl` today.
  // v14: DEMO_PARTNERS grew by ~221 entries (mock/gtmPartners.ts — GTM Coverage's own
  // distributor roster, folded in so Partners/GTM Coverage/Analytics all derive their
  // distributor counts from the same live array instead of drifting apart). The v9 catch-up
  // below only appends a DEMO_PARTNERS id missing from the persisted `partners` array, but it's
  // gated behind migrate() actually running — a session already sitting at v13 never re-runs
  // it and stays stuck on its old, much smaller partners list. Bump to force it once more.
  // v15: added ~8 recently-discontinued distributors to the seed roster (mock/gtmPartners.ts) so
  // Analytics' Partner Aging "deboarded" line shows real churn instead of a flat zero. New seed
  // ids get appended by the v9 catch-up below, but only when migrate() actually runs — bump so
  // sessions already sitting at v14 pick them up.
  // v16: added `dbCode` to every distributor in DEMO_PARTNERS (Create Lead's "OLD DB Code"
  // picker looks distributors up by it) — the v12 full-resync below already backfills any new
  // seed field onto an already-persisted partner, but only runs when migrate() actually fires.
  // Bump so sessions already sitting at v15 pick up dbCode instead of seeing an empty picker.
  // v17: person-level assignment landed — every case now carries an `assigneeId` (+ caseType).
  // Sessions persisted before this have neither, so their queue would render "Unassigned" and
  // the My Work / on-leave reassignment features would have nothing to act on. Backfill an
  // assignee onto every carried case (territory + round-robin, via assignSeedCases) on migrate.
  // v18: cases gained a `caseState` (workflow position on the state machine, driven by the new
  // Case Detail workspace). assignSeedCases now backfills it too, but a session already sitting
  // at v17 won't re-run migrate — bump so caseState is derived for those cases as well.
  // v19: appointment state machine re-modelled to the runtime lifecycle; re-derive caseState.
  // v20: cases gained turnover-driven `expectedTurnover`/`signoffAuthority`; assignSeedCases now
  // backfills a band per seeded case so the banded authority matrix is visible.
  // v21: an approved case now derives caseState 'ACTIVE' (was showing 'Final Sign-off / In progress'
  // for approved Finance/Channel-owned cases) — re-derive so persisted approved cases read Active.
  // v22: per-case SLA — assignSeedCases backfills slaAnchorAt/slaDueAt so every case has its own
  // live SLA clock; bump so persisted cases pick one up.
  // v23: activating a case (Leadership approval) used to require a candidateId — seeded demo
  // cases (QUEUE_CASES) never carry one, so approving one all the way through silently dead-ended
  // with no Partner record and no onboarding case, ever. Backfills both for any already-activated
  // case that's missing them (see partnerIdFor/the onboardingCases backfill loop below).
  // v24: 'auto_cleared' seeded cases (CMP-2265, CMP-2312 — never needed ANY human review) hit the
  // exact same dead end and were never covered by v23's Leadership-only check. isActivatedCase now
  // treats them as activated too, so they finally get a Partner + onboarding case sent to IT.
  // v25: advanceOnboarding used to hand ownership back to ase_asm once a case left Appointment —
  // it now stays with IT for the case's whole life, but that only affects future transitions.
  // Re-sync ownerRole to 'it' on every already-persisted onboarding case past Appointment so
  // sessions that advanced before this change don't keep showing the old field owner.
  // v26: onboarding collapsed to just Appointment → Complete — Training/Handholding/Central
  // Induction no longer exist in TRANSITIONS/STATE_ORDER. Any already-persisted case still
  // sitting in one of those removed states would render as a broken stepper (not found in the
  // ladder, no button ever shows) — fold it straight to Complete, the equivalent end state.
  // v27: the seed onboarding case 'onb-godavari' never carried a partnerId — it floated
  // disconnected from the real Godavari Traders partner (p7, dbCode DB-1007), showing "Complete"
  // with no DB Code and nothing to cross-reference in Partners. Link it for any session that
  // already persisted the old, unlinked version.
  // v28: v24's fix had a bug of its own — CMP-2265/CMP-2312 already had their OWN seed Partner
  // row (p15 Ganga Traders DB-1015, p16 Om Sai Distributors DB-1016), but partnerIdFor's case-code
  // fallback didn't check for that, so it minted a SECOND, duplicate partner (case:CMP-2265,
  // case:CMP-2312) with a fresh, wrong DB Code the moment a session persisted post-v24. Removes
  // those two duplicates and their spawned onboarding cases now that partnerIdFor checks first.
  // v29: same v7/v8 problem again — a session reloaded between the v28 version bump landing and
  // its actual cleanup code landing got persisted already stamped `version: 28`, so the cleanup
  // never ran for it. Bump to force it through once more (the cleanup itself is unchanged).
  // v30: removed a pre-existing GTM seed duplicate ('gtm:GJ:ganga-traders-2', Surat GJ — a
  // generation artifact colliding with the real seeded Ganga Traders, p15/DB-1015). The v9
  // catch-up below only ever appends a seed id that's missing, it never removes one that's gone
  // — explicitly drop it from any already-persisted session too.
  // v31: a full audit of the GTM seed roster (mock/gtmPartners.ts) turned up four more exact
  // duplicates of the same "-2" generation-artifact shape — identical name/town/state/date to
  // another row already in the file. Removed from the seed; drop them from already-persisted
  // sessions too, same reasoning as v30.
  // v32: advanceWorkbasketItem used to only bridge a DB into a real lead once it hit 'done' — now
  // it fires as soon as an ASE marks a DB 'in_progress', so the ASM doesn't have to wait for it to
  // finish before reviewing/submitting it. Any session that already had DBs sitting at
  // in_progress/done from before this change never got that lead created (the bridge only runs on
  // the status-change action itself, not retroactively) — backfill one for each now.
  // v33: same v7/v8/v29 problem again — a session reloaded between the v32 version bump landing
  // and the backfill loop itself landing got persisted already stamped `version: 32`, so the
  // backfill never actually ran for it (Trimbak Distributors / Ramkund Traders stayed leadless).
  // Bump to force it through once more (the backfill logic itself is unchanged).
  // v34: leadFromWorkbasketDb minted these leads with dbCategory 'GT DB' — not a real DB_TYPES
  // value ('GT DB (with CSO/DSM)' / 'GM Excl DB' / 'Traders'). New Application's compare-lock
  // treats dbCategory as an exact-match key, so any workbasket-derived lead silently became
  // un-tickable for comparison the moment any other-category lead was already ticked. Rewrite
  // any already-persisted 'GT DB' candidate to the real category now.
  // v35: mock/workbasket.ts's ~60-item DB Pool was mostly fabricated placeholder companies with
  // no candidate behind them anywhere else in the system — leads built from one had every field
  // guessed off a name hash. The pool is now exactly the real scouted candidates from
  // INITIAL_SCOUTING (5 total). Drop any already-persisted workbasket item that isn't one of
  // those real candidates, and any lead (candidates entry `lead-${id}`) built from a dropped one.
  // v36: same v7/v8/v29/v33 problem yet again — a session got persisted already stamped
  // `version: 35` (still carrying all 60 fabricated items) before the v35 cleanup itself had
  // landed. Bump to force it through once more (the cleanup logic is unchanged).
  version: 36,
  migrate: (persisted) => {
    const SEED_IDS = new Set(['c1', 'c2', 'c3'])
    const p = persisted as {
      candidates?: CandidateCard[]; evalIds?: string[]; selectedCandidateId?: string
      flaggedCases?: CaseRecord[]; partners?: Partner[]; onboardingCases?: OnboardingCase[]
      workbasket?: WorkbasketItem[]
    }
    if (p?.candidates) {
      p.candidates = p.candidates.filter((c) => !SEED_IDS.has(c.id))
      p.evalIds = (p.evalIds ?? []).filter((id) => p.candidates!.some((c) => c.id === id))
      if (p.selectedCandidateId && !p.candidates.some((c) => c.id === p.selectedCandidateId)) {
        p.selectedCandidateId = p.candidates[0]?.id ?? ''
      }
    }
    // Pre-v3 sessions never had flaggedCases — start from the current seed and keep only
    // wizard-raised cases (candidateId set) a user actually created, not a stale seed copy.
    const carried = (p?.flaggedCases ?? []).filter((c) => c.candidateId)
    // Rewrite any legacy `NA-${candidateId}` codes (pre-v4) into the CMP-#### / VND-#### format,
    // one at a time so codes generated within the same old session still land on distinct numbers.
    const rewritten: CaseRecord[] = []
    for (const c of carried) {
      if (c.code.startsWith('NA-')) {
        const code = nextCaseCode([...QUEUE_CASES, ...rewritten], c.partnerType)
        rewritten.push({ ...c, code })
      } else {
        rewritten.push(c)
      }
    }
    let flaggedCases = [...rewritten, ...QUEUE_CASES.filter((c) => !rewritten.some((x) => x.code === c.code))]
    // Pre-v5: a Finance/Channel Dev approval closed the case outright with no next step.
    // Push any such case still short of a real Leadership sign-off into that queue now.
    flaggedCases = flaggedCases.map((c) => {
      const stuck = c.status === 'approved' && (c.ownerRole === 'finance' || c.ownerRole === 'channel_dev')
        && !(c.candidateId && p.candidates?.some((cd) => cd.id === c.candidateId && cd.stage === 'active'))
      if (!stuck) return c
      const authority = c.signoffAuthority ?? 'SM'
      return { ...c, status: 'flagged', ownerRole: 'leadership', flagDetail: `Financial & infra checks clear — routed to ${authority} for final sign-off.` }
    })
    p.flaggedCases = flaggedCases
    // Pre-v6 sessions never had `partners` — start from the seed roster, then catch up any
    // case that's already active-bound (leadership-owned + approved, or a candidate already at
    // stage 'active') but never got its Partner record created.
    let partners = p.partners ?? DEMO_PARTNERS
    // v9: also catch up any DEMO_PARTNERS entry a session's persisted `partners` predates —
    // same append-what's-missing-by-id approach as flaggedCases already does for QUEUE_CASES.
    partners = [...partners, ...DEMO_PARTNERS.filter((seed) => !partners.some((pt) => pt.id === seed.id))]
    // v30: explicitly drop a seed id that's been REMOVED from DEMO_PARTNERS since — the v9
    // catch-up above only ever adds, so a removed seed would otherwise linger forever.
    const V30_31_REMOVED_SEED_IDS = new Set([
      'gtm:GJ:ganga-traders-2', 'gtm:HR:united-sales-corporation-2', 'gtm:MH:ganga-distributors-2',
      'gtm:SK:prime-commercial-agency-2', 'gtm:WB:maa-trading-co-2', 'gtm:HP:shri-sons-2',
    ])
    partners = partners.filter((pt) => !V30_31_REMOVED_SEED_IDS.has(pt.id))
    // v10: backfill onboardedAt/discontinuedAt onto partners persisted before those fields
    // existed — appending only helps brand-new ids, not already-persisted ones missing new fields.
    // v12: fully resync any seed-id partner (never touched by app logic — see comment on
    // `version` above) from the current DEMO_PARTNERS row, so a stale legalName/status/town from
    // before a seed-data refresh doesn't linger forever in an already-persisted session.
    partners = partners.map((pt) => {
      const seed = DEMO_PARTNERS.find((s) => s.id === pt.id)
      return seed ? { ...pt, ...seed } : pt
    })
    // v23: this used to also require c.candidateId — seeded demo cases (QUEUE_CASES) never carry
    // one, so approving one all the way through Leadership silently dead-ended: no Partner record,
    // no onboarding case, nothing for IT to ever see. Dropped the requirement; partnerIdFor's
    // case-code fallback (below) gives every seeded case a stable, non-colliding partner id too.
    // v24: 'auto_cleared' cases (a clean case that never needed ANY human review — Finance/Channel
    // Dev/Leadership all skipped) are activated too, own_role or not — CMP-2265/CMP-2312 sat in
    // this state forever with no Partner, no onboarding, nothing for IT, same dead end as above.
    const isActivatedCase = (c: CaseRecord) => {
      const candidateActive = !!c.candidateId && p.candidates?.some((cd) => cd.id === c.candidateId && cd.stage === 'active')
      return c.status === 'auto_cleared' || (c.ownerRole === 'leadership' && (c.status === 'approved' || !!candidateActive))
    }
    for (const c of flaggedCases) {
      if (isActivatedCase(c)) partners = upsertActivePartner(partners, c)
    }
    // v28: drop the two duplicate partners v24 accidentally minted before partnerIdFor checked
    // for an existing one — the real Ganga Traders (p15, DB-1015) / Om Sai Distributors (p16,
    // DB-1016) already existed.
    const V28_DUPLICATE_PARTNER_IDS = new Set(['case:CMP-2265', 'case:CMP-2312'])
    partners = partners.filter((pt) => !V28_DUPLICATE_PARTNER_IDS.has(pt.id))
    // Backfill the onboarding case itself for any already-activated case that never got one —
    // never ran for seeded cases before v23/v24, and onboardingCases was never migrated at all
    // before v23.
    const V28_DUPLICATE_ONBOARDING_IDS = new Set(['onb-CMP-2265', 'onb-CMP-2312'])
    const onboardingCases = (p.onboardingCases ?? INITIAL_ONBOARDING).filter((o) => !V28_DUPLICATE_ONBOARDING_IDS.has(o.id))
    const backfilledOnboarding = [...onboardingCases]
    for (const c of flaggedCases) {
      if (!isActivatedCase(c) || backfilledOnboarding.some((o) => o.parentCaseCode === c.code)) continue
      // If this case resolves (by name+town+state) to a partner that's already fully onboarded
      // with a DB Code — a seed case ingested alongside its own already-onboarded seed Partner
      // row, e.g. CMP-2265/CMP-2312 → p15/p16 — there's nothing pending; don't spawn a queue item.
      const resolvedPartner = partners.find((pt) => pt.id === partnerIdFor(partners, c))
      if (resolvedPartner?.dbCode) continue
      backfilledOnboarding.push(buildOnboardingCase(partners, c, 'System'))
    }
    // v25: IT owns an onboarding case for its whole life now, not just Appointment — re-sync any
    // already-persisted case that advanced past Appointment under the old hand-back-to-ase_asm rule.
    const REMOVED_ONBOARDING_STATES = new Set(['TRAINING', 'HANDHOLDING', 'CENTRAL_INDUCTION'])
    p.onboardingCases = backfilledOnboarding.map((o) => {
      // v27: link the seed Godavari Traders case to its real partner if an older session
      // persisted it before partnerId existed on this record.
      if (o.id === 'onb-godavari' && !o.partnerId) o = { ...o, partnerId: 'p7', town: 'Nashik' }
      if (o.caseState === 'APPOINTMENT') return o
      const caseState = REMOVED_ONBOARDING_STATES.has(o.caseState) ? 'COMPLETE' : o.caseState
      return { ...o, caseState, ownerRole: 'it' }
    })
    // Rename the one candidate/case/partner set that collided with the unrelated discontinued
    // seed partner of the same name — never touches p4 (Ganesh Distributors) itself.
    const RENAMED_CANDIDATE_ID = 'intake-ganesh-distributors'
    if (p.candidates) {
      p.candidates = p.candidates.map((cd) => (cd.id === RENAMED_CANDIDATE_ID ? { ...cd, name: 'Ganpati Distributors' } : cd))
    }
    p.flaggedCases = flaggedCases.map((c) => (c.candidateId === RENAMED_CANDIDATE_ID ? { ...c, partnerName: 'Ganpati Distributors' } : c))
    p.partners = partners.map((pt) => (pt.id === `candidate:${RENAMED_CANDIDATE_ID}` ? { ...pt, legalName: 'Ganpati Distributors' } : pt))
    // v13: coerce any pre-v13 financeDocsUploaded string value into the current { name, dataUrl }
    // shape — no real file bytes to backfill (only the filename ever existed), but at least the
    // name displays and it stops silently reading as undefined.
    p.flaggedCases = (p.flaggedCases ?? []).map((c) => {
      if (!c.financeDocsUploaded) return c
      const fixed = Object.fromEntries(
        Object.entries(c.financeDocsUploaded).map(([k, v]) => [k, typeof v === 'string' ? { name: v } : v]),
      )
      return { ...c, financeDocsUploaded: fixed }
    })
    // v17: give every carried case a person-level assignee (+ caseType) if it doesn't have one,
    // so the queue, My Work view and on-leave reassignment have real assignments to work with.
    p.flaggedCases = assignSeedCases(p.flaggedCases ?? [])
    // v19: the appointment state machine was re-modelled to the runtime lifecycle (Submitted →
    // Under Review → Leadership Sign-off → Active). Re-derive caseState for every carried case so
    // sessions persisted on the old DRAFT…BILLING states move onto the new ones.
    p.flaggedCases = p.flaggedCases.map((c) => ({ ...c, caseState: deriveCaseState(c) }))
    // v35: drop any already-persisted workbasket item that isn't one of the real scouted
    // candidates INITIAL_WORKBASKET now models (see version comment above), and any lead a
    // dropped fabricated item was already bridged into.
    const REAL_WORKBASKET_IDS = new Set(INITIAL_WORKBASKET.map((it) => it.id))
    const preV35Workbasket = p.workbasket ?? INITIAL_WORKBASKET
    const droppedWorkbasketIds = new Set(preV35Workbasket.filter((it) => !REAL_WORKBASKET_IDS.has(it.id)).map((it) => it.id))
    let workbasket = preV35Workbasket.filter((it) => REAL_WORKBASKET_IDS.has(it.id))
    // Catch up any real candidate this session predates (same append-what's-missing approach as
    // the v9 partners catch-up above).
    workbasket = [...workbasket, ...INITIAL_WORKBASKET.filter((seed) => !workbasket.some((it) => it.id === seed.id))]
    if (droppedWorkbasketIds.size) {
      p.candidates = (p.candidates ?? []).filter((c) => !(c.id.startsWith('lead-') && droppedWorkbasketIds.has(c.id.slice(5))))
      p.evalIds = (p.evalIds ?? []).filter((id) => (p.candidates ?? []).some((c) => c.id === id))
    }
    // v32: backfill a lead for any workbasket DB already at in_progress/done that never got one
    // (see version comment above).
    const missingLeads = workbasket
      .filter((it) => (it.status === 'in_progress' || it.status === 'done') && !(p.candidates ?? []).some((c) => c.id === `lead-${it.id}`))
      .map((it) => leadFromWorkbasketDb(it))
    if (missingLeads.length) p.candidates = [...missingLeads, ...(p.candidates ?? [])]
    // v34: rewrite the bogus 'GT DB' category left behind by the v32/v33 backfill (or the live
    // action, for a session that advanced a DB before this fix) to the real DB_TYPES value.
    p.candidates = (p.candidates ?? []).map((c) => (c.dbCategory === 'GT DB' ? { ...c, dbCategory: DB_TYPES[0] } : c))
    p.workbasket = workbasket
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return p as any
  },
}))

// "Who am I, really" — prefers the actual logged-in person (authUser) over the persona
// switcher's one-per-role stand-in (DEMO_USERS[viewingAs]). Without this, two different people
// who share a role (e.g. two ASEs) were indistinguishable: whichever role you were "viewing as",
// every "my assigned DBs" / "my worklist" lookup always resolved to the SAME hardcoded
// representative for that role, so logging in as a different real person never showed different
// data. Falls back to DEMO_USERS when authUser is absent or you've switched viewingAs away from
// who's actually logged in (the persona-switcher's own demo mode).
// Whichever branch resolves the base identity, its `access` (View/Manage per screen) is then
// swapped for the LIVE entry in the `users` array when one exists for that same id — Admin & Team's
// per-user edits only take effect this way; authUser/DEMO_USERS otherwise carry the stale snapshot
// they were built with (backend login response / DEFAULT_ACCESS_BY_ROLE) forever.
export function useMe(): User | null {
  const authUser = useApp((s) => s.authUser)
  const viewingAs = useApp((s) => s.viewingAs)
  const users = useApp((s) => s.users)
  const base = (authUser && authUser.roleCode === viewingAs) ? authUser : (viewingAs ? DEMO_USERS[viewingAs] ?? null : null)
  if (!base) return null
  const live = users.find((u) => u.id === base.id)
  return live ? { ...base, access: live.access } : base
}

// Screens a persona can actually see: the per-role ceiling (moduleAccess[role], set by Admin &
// Settings' "Screen access" tab) narrowed by the specific person's own per-screen View toggle
// (Admin & Team's "Edit user" grid), when they carry one. Dashboard is a screen like any other
// here — fully editable, same as every other row — see Shell.tsx's landingPath for what a persona
// with Dashboard (or everything) switched off actually lands on instead.
export function allowedScreens(roleAllowed: string[], me: User | null): string[] {
  return roleAllowed.filter((path) => me?.access?.[path]?.view ?? true)
}

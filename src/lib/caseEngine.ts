// The workflow spine: legal state transitions per case type + helpers to build the
// append-only timeline events every case carries. Transitions are DATA (inspectable,
// testable) rather than logic buried in JSX — the appointment map is derived from the
// design doc's Appendix A.2, scouting from A.1.

import type { CaseEvent, CaseType } from '../types'

/** Legal `from → [to]` transitions for each case type. An empty array = terminal state. */
export const TRANSITIONS: Record<CaseType, Record<string, string[]>> = {
  scouting: {
    REGISTER: ['SHORTLISTED', 'CANCELLED'],
    SHORTLISTED: ['RETAILER_FEEDBACK', 'CANCELLED'],
    RETAILER_FEEDBACK: ['INTEREST_CHECK', 'CANCELLED'],
    INTEREST_CHECK: ['HANDED_OFF', 'CANCELLED'],
    HANDED_OFF: [],
    CANCELLED: [],
  },
  // Runtime lifecycle of an appointment case — the two-evaluation + final sign-off model the app
  // actually runs (discovery-doc), so the state machine and the real decisions are one and the same.
  appointment: {
    SUBMITTED: ['UNDER_REVIEW', 'LEADERSHIP_SIGNOFF', 'REJECTED'],
    UNDER_REVIEW: ['LEADERSHIP_SIGNOFF', 'REJECTED'],
    LEADERSHIP_SIGNOFF: ['ACTIVE', 'REJECTED'],
    ACTIVE: [],
    REJECTED: [],
  },
  // Collapsed to just Appointment → Complete — DB Code creation is the only real step; once IT
  // creates it the DB is fully onboarded and simply sits in Partners, no separate Training/
  // Handholding/Central Induction stages to click through.
  onboarding: {
    APPOINTMENT: ['COMPLETE'],
    COMPLETE: [],
  },
  // Recurring / later-phase case types — states declared as they get built out.
  evaluation: {},
  jbp: {},
  separation: {},
  continuity: {},
}

export const START_STATE: Partial<Record<CaseType, string>> = {
  scouting: 'REGISTER',
  appointment: 'SUBMITTED',
  onboarding: 'APPOINTMENT',
}

/** The "happy path" order of states per type — drives the stepper on the Case Detail view.
 *  Off-path states (REJECTED / CANCELLED) are intentionally excluded from the ladder. */
export const STATE_ORDER: Record<CaseType, string[]> = {
  scouting: ['REGISTER', 'SHORTLISTED', 'RETAILER_FEEDBACK', 'INTEREST_CHECK', 'HANDED_OFF'],
  appointment: ['SUBMITTED', 'UNDER_REVIEW', 'LEADERSHIP_SIGNOFF', 'ACTIVE'],
  onboarding: ['APPOINTMENT', 'COMPLETE'],
  evaluation: [],
  jbp: [],
  separation: [],
  continuity: [],
}

/** Terminal states that close a case (or take it off the happy path). */
export const TERMINAL_STATES = new Set(['ACTIVE', 'COMPLETE', 'HANDED_OFF', 'REJECTED', 'CANCELLED'])

const STATE_LABEL: Record<string, string> = {
  // scouting
  REGISTER: 'Register', SHORTLISTED: 'Shortlisted', RETAILER_FEEDBACK: 'Retailer Feedback',
  INTEREST_CHECK: 'Interest Check', HANDED_OFF: 'Handed Off', CANCELLED: 'Cancelled',
  // appointment (runtime lifecycle)
  SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under Review', LEADERSHIP_SIGNOFF: 'Final Sign-off',
  ACTIVE: 'Active', REJECTED: 'Rejected',
  // onboarding
  APPOINTMENT: 'Appointment', TRAINING: 'Training', HANDHOLDING: 'Handholding',
  CENTRAL_INDUCTION: 'Central Induction', COMPLETE: 'Complete',
}

export const stateLabel = (s?: string): string => (s ? STATE_LABEL[s] ?? s : '—')

// Plain-language description of each workflow state — shared by Approvals' stepper and the
// Dashboard's "what's going on" column, so both surfaces describe a state the same way.
export const STATE_DESC: Record<string, string> = {
  SUBMITTED: 'Recommendation submitted; the engine auto-evaluates and routes it.',
  UNDER_REVIEW: 'The flagged dimension is with Finance / Trade Marketing for review.',
  LEADERSHIP_SIGNOFF: 'Both checks cleared — awaiting final approval (ASE fast-track for a clean case, else SM/RBL).',
  ACTIVE: 'Signed off — the distributor is now active.',
  REJECTED: 'Returned to the sales team; not proceeding.',
  APPOINTMENT: 'Agreement signed — with IT for DB Code creation (D+2).',
  COMPLETE: 'DB Code created — onboarding complete, now sitting in Partners.',
}

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  scouting: 'Scouting', appointment: 'Appointment', onboarding: 'Onboarding',
  evaluation: 'Evaluation', jbp: 'JBP', separation: 'Separation', continuity: 'Continuity',
}

/** Is `to` a legal next state from `from` for this case type? */
export function canTransition(type: CaseType, from: string, to: string): boolean {
  return (TRANSITIONS[type]?.[from] ?? []).includes(to)
}

/** Human-readable timeline stamp for an epoch, e.g. '20 Jul 2026, 11:20 AM'. */
export function stamp(at: number): string {
  const d = new Date(at)
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  return `${date}, ${time}`
}

let _seq = 0
/** Build a CaseEvent with a unique id + timestamp. `at` defaults to now. */
export function makeEvent(e: {
  kind: CaseEvent['kind']
  actor: string
  summary: string
  fromState?: string
  toState?: string
  at?: number
}): CaseEvent {
  const at = e.at ?? Date.now()
  return {
    id: `ce-${at}-${_seq++}`,
    at,
    when: stamp(at),
    kind: e.kind,
    actor: e.actor,
    summary: e.summary,
    fromState: e.fromState,
    toState: e.toState,
  }
}

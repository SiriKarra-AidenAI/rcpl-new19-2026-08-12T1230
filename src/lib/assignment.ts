// The assignment resolver: given a case's owning role + territory, pick the right PERSON —
// preferring the same state, then region, load-balanced across whoever is on duty. Also
// resolves the backup when someone goes on leave, and walks the manager ladder for escalation.
// Pure functions over the roster + the store's availability overrides (no side effects).

import type { Availability, CaseRecord, RoleCode, TeamMember } from '../types'
import { TEAM, TEAM_BY_ID } from '../mock/team'
import { START_STATE } from './caseEngine'

/** The workflow state that corresponds to a case's current status + owning role — the single
 *  mapping used everywhere so `caseState`, `status` and the timeline never drift apart. */
export function deriveCaseState(c: CaseRecord): string {
  const type = c.caseType ?? 'appointment'
  if (type !== 'appointment') return START_STATE[type] ?? 'SUBMITTED'
  if (c.status === 'rejected') return 'REJECTED'
  if (c.status === 'approved') return 'ACTIVE'   // approved = resolved, regardless of which team cleared it
  // still open (flagged)
  if (c.autoCleared) return 'LEADERSHIP_SIGNOFF'  // no issues → straight to final approval
  if (c.ownerRole === 'leadership') return 'LEADERSHIP_SIGNOFF'
  if (c.ownerRole === 'finance' || c.ownerRole === 'channel_dev' || c.ownerRole === 'mdm') return 'UNDER_REVIEW'
  return 'SUBMITTED'
}

/** Effective availability = the store's per-user override, else the roster's seeded value. */
export function effectiveAvailability(userId: string, overrides: Record<string, Availability>): Availability {
  return overrides[userId] ?? TEAM_BY_ID[userId]?.availability ?? { status: 'on_duty' }
}

export function isUserAvailable(userId: string, overrides: Record<string, Availability>): boolean {
  const m = TEAM_BY_ID[userId]
  if (!m || m.isActive === false) return false
  return effectiveAvailability(userId, overrides).status === 'on_duty'
}

/** Whether a case is still live work (not closed) — only open cases get (re)assigned. */
export const isOpenCase = (c: CaseRecord): boolean => c.status !== 'approved' && c.status !== 'rejected'

/** Members who can be a front-line ASSIGNEE for a role — SM/RBL are escalation rungs, not
 *  first-line handlers, so they're excluded from the normal assignment pool. */
export function eligibleMembers(role: RoleCode, state?: string): TeamMember[] {
  const inRole = TEAM.filter((m) => m.roleCode === role && m.level !== 'SM' && m.level !== 'RBL' && m.isActive !== false)
  const byState = state ? inRole.filter((m) => m.state === state) : []
  return byState.length ? byState : inRole
}

/** Pick the best assignee for a case: on duty, in territory, with the lightest open workload. */
export function pickAssignee(input: {
  role: RoleCode
  state?: string
  cases: CaseRecord[]
  overrides: Record<string, Availability>
  exclude?: string[]
}): string | undefined {
  const pool = eligibleMembers(input.role, input.state)
    .filter((m) => isUserAvailable(m.id, input.overrides))
    .filter((m) => !input.exclude?.includes(m.id))
  if (!pool.length) return undefined
  const load = (id: string) => input.cases.filter((c) => c.assigneeId === id && isOpenCase(c)).length
  return [...pool].sort((a, b) => load(a.id) - load(b.id))[0].id
}

/** Who inherits a person's work while they're away: their chosen backup (if on duty), else the
 *  lightest-loaded on-duty peer in the same role + territory. */
export function backupFor(
  userId: string,
  cases: CaseRecord[],
  overrides: Record<string, Availability>,
): string | undefined {
  const av = effectiveAvailability(userId, overrides)
  if (av.backupUserId && isUserAvailable(av.backupUserId, overrides)) return av.backupUserId
  const m = TEAM_BY_ID[userId]
  if (!m) return undefined
  return pickAssignee({ role: m.roleCode, state: m.state, cases, overrides, exclude: [userId] })
}

/** The next rung up the escalation ladder from a person. */
export function managerOf(userId?: string): TeamMember | undefined {
  const m = userId ? TEAM_BY_ID[userId] : undefined
  return m?.managerId ? TEAM_BY_ID[m.managerId] : undefined
}

/** Deterministically give every unassigned case an assignee — used to seed the demo queue and
 *  to backfill sessions persisted before assignment existed. Order-stable, no randomness. */
export function assignSeedCases(
  cases: CaseRecord[],
  overrides: Record<string, Availability> = {},
): CaseRecord[] {
  const counts: Record<string, number> = {}
  // Seeded cases carry no turnover — cycle representative values across the three authority bands
  // (< ₹10 L, ₹10–50 L, > ₹50 L) so the banded Visit-Contact/approval matrix is visible in the demo.
  const DEMO_BANDS = [8, 30, 75]
  const DEMO_SLA_HRS = [-14, 6, 40]  // per-case SLA: one overdue, one due-soon, one on-track
  const now = Date.now()
  return cases.map((c, i) => {
    const expectedTurnover = c.expectedTurnover ?? DEMO_BANDS[i % DEMO_BANDS.length]
    const anchorAt = c.slaAnchorAt ?? now
    const dueAt = c.slaDueAt ?? (c.isOverdue ? now - 14 * 3600e3 : now + DEMO_SLA_HRS[i % DEMO_SLA_HRS.length] * 3600e3)
    const withType: CaseRecord = {
      ...c, caseType: c.caseType ?? 'appointment', caseState: c.caseState ?? deriveCaseState(c),
      expectedTurnover, signoffAuthority: c.signoffAuthority ?? (expectedTurnover > 50 ? 'RBL' : 'SM'),
      slaAnchorAt: anchorAt, slaDueAt: dueAt,
    }
    if (withType.assigneeId) return withType
    const pool = eligibleMembers(c.ownerRole, c.state).filter((m) => isUserAvailable(m.id, overrides))
    if (!pool.length) return withType
    const pick = [...pool].sort((a, b) => (counts[a.id] ?? 0) - (counts[b.id] ?? 0))[0]
    counts[pick.id] = (counts[pick.id] ?? 0) + 1
    return { ...withType, assigneeId: pick.id }
  })
}

import { describe, it, expect } from 'vitest'
import { addWorkingDays, workingDaysBetween, liveSlaState, liveSlaLabel } from './workingDays'
import { deriveCaseState, eligibleMembers, pickAssignee, backupFor, managerOf, assignSeedCases } from './assignment'
import { canTransition, stateLabel, START_STATE } from './caseEngine'
import { computeRoi } from './roi'
import { authorityFor } from '../mock/authorityMatrix'
import type { Availability, CaseRecord } from '../types'

const c = (o: Partial<CaseRecord>): CaseRecord => ({
  code: 'C', partnerName: 'P', partnerType: 'distributor', town: 'Pune', state: 'Maharashtra',
  subtype: 'new', status: 'flagged', ownerRole: 'finance', slaLabel: '', isOverdue: false,
  hasDiscontinuationForm: true, confidencePct: 90, ...o,
})

describe('EDGE — workingDays', () => {
  const mon = new Date(2026, 6, 13).getTime()
  it('addWorkingDays(0) on a weekday stays; on a weekend rolls forward', () => {
    expect(new Date(addWorkingDays(mon, 0)).getDay()).toBe(1) // Monday unchanged
    const sat = new Date(2026, 6, 18).getTime()
    const d = new Date(addWorkingDays(sat, 0)).getDay()
    expect(d === 0 || d === 6).toBe(false) // rolled off the weekend
  })
  it('workingDaysBetween is signed', () => {
    expect(workingDaysBetween(addWorkingDays(mon, 3), mon)).toBe(-3)
    expect(workingDaysBetween(mon, mon)).toBe(0)
  })
  it('liveSlaState boundaries', () => {
    const now = mon
    expect(liveSlaState(now - 1, now)).toBe('overdue')
    expect(liveSlaState(now + 4 * 3600e3, now)).toBe('due_soon')
    expect(liveSlaState(now + 48 * 3600e3, now)).toBe('on_track')
  })
  it('liveSlaLabel overdue in hours vs days', () => {
    const now = mon
    expect(liveSlaLabel(now - 3 * 3600e3, now)).toBe('Overdue 3h')
    expect(liveSlaLabel(now - 50 * 3600e3, now)).toBe('Overdue 2d')
    expect(liveSlaLabel(now + 5 * 3600e3, now)).toBe('5h left')
  })
})

describe('EDGE — assignment failure modes', () => {
  it('pickAssignee returns undefined when every eligible peer is on leave', () => {
    const overrides: Record<string, Availability> = {}
    for (const m of eligibleMembers('ase_asm')) overrides[m.id] = { status: 'on_leave' }
    expect(pickAssignee({ role: 'ase_asm', cases: [], overrides })).toBeUndefined()
  })
  it('managerOf returns undefined at the top of the chain (RBL)', () => {
    expect(managerOf('u-rbl')).toBeUndefined()
    expect(managerOf(undefined)).toBeUndefined()
    expect(managerOf('nonexistent')).toBeUndefined()
  })
  it('backupFor returns undefined for an unknown user', () => {
    expect(backupFor('nobody', [], {})).toBeUndefined()
  })
  it('assignSeedCases([]) is empty and never throws', () => {
    expect(assignSeedCases([])).toEqual([])
  })
})

describe('EDGE — deriveCaseState across every branch', () => {
  it('non-appointment types use their start state', () => {
    expect(deriveCaseState(c({ caseType: 'scouting' }))).toBe(START_STATE.scouting)
    expect(deriveCaseState(c({ caseType: 'onboarding' }))).toBe(START_STATE.onboarding)
  })
  it('appointment: approved → ACTIVE, rejected → REJECTED', () => {
    expect(deriveCaseState(c({ status: 'approved' }))).toBe('ACTIVE')
    expect(deriveCaseState(c({ status: 'rejected' }))).toBe('REJECTED')
  })
  it('appointment: autoCleared flagged → final sign-off (LEADERSHIP_SIGNOFF)', () => {
    expect(deriveCaseState(c({ status: 'flagged', ownerRole: 'asm', autoCleared: true }))).toBe('LEADERSHIP_SIGNOFF')
  })
  it('appointment: flagged mdm/finance/channel → UNDER_REVIEW', () => {
    expect(deriveCaseState(c({ status: 'flagged', ownerRole: 'mdm' }))).toBe('UNDER_REVIEW')
  })
})

describe('EDGE — caseEngine / roi / authority', () => {
  it('canTransition is false for unknown type or state', () => {
    // @ts-expect-error unknown type
    expect(canTransition('nope', 'A', 'B')).toBe(false)
    expect(canTransition('appointment', 'UNKNOWN', 'ACTIVE')).toBe(false)
  })
  it('stateLabel passes through unknown codes', () => {
    expect(stateLabel('WEIRD_STATE')).toBe('WEIRD_STATE')
  })
  it('computeRoi guards divide-by-zero', () => {
    expect(computeRoi(41, 0)).toBe(0)
    expect(computeRoi(0, 100)).toBe(0)
  })
  it('authorityFor clamps to the top band above ₹50L', () => {
    expect(authorityFor(9999).finalise).toBe('ASM + SM/RBL')
    expect(authorityFor(0).label).toBe('< ₹10 L')
  })
})

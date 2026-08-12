import { describe, it, expect } from 'vitest'
import { deriveCaseState, eligibleMembers, pickAssignee, backupFor, isUserAvailable, assignSeedCases } from './assignment'
import type { CaseRecord } from '../types'

const base = (over: Partial<CaseRecord>): CaseRecord => ({
  code: 'CMP-1', partnerName: 'Test', partnerType: 'distributor', town: 'Pune', state: 'Maharashtra',
  subtype: 'new', status: 'flagged', ownerRole: 'finance', slaLabel: '6h', isOverdue: false,
  hasDiscontinuationForm: true, confidencePct: 90, ...over,
})

describe('deriveCaseState — one mapping for status+role', () => {
  it('flagged finance/channel → UNDER_REVIEW', () => {
    expect(deriveCaseState(base({ status: 'flagged', ownerRole: 'finance' }))).toBe('UNDER_REVIEW')
    expect(deriveCaseState(base({ status: 'flagged', ownerRole: 'channel_dev' }))).toBe('UNDER_REVIEW')
  })
  it('flagged leadership → LEADERSHIP_SIGNOFF', () => {
    expect(deriveCaseState(base({ status: 'flagged', ownerRole: 'leadership' }))).toBe('LEADERSHIP_SIGNOFF')
  })
  it('approved by leadership → ACTIVE', () => {
    expect(deriveCaseState(base({ status: 'approved', ownerRole: 'leadership' }))).toBe('ACTIVE')
  })
  it('rejected → REJECTED', () => {
    expect(deriveCaseState(base({ status: 'rejected' }))).toBe('REJECTED')
  })
})

describe('eligibleMembers — excludes SM/RBL escalation rungs', () => {
  it('ase_asm pool is ASE/ASM only, no SM/RBL', () => {
    const ids = eligibleMembers('ase_asm').map((m) => m.level)
    expect(ids).not.toContain('SM')
    expect(ids).not.toContain('RBL')
    expect(ids).toContain('ASE')
  })
  it('prefers members in the same state', () => {
    const mh = eligibleMembers('ase_asm', 'Maharashtra')
    expect(mh.every((m) => m.state === 'Maharashtra')).toBe(true)
    expect(mh.length).toBeGreaterThan(0)
  })
})

describe('pickAssignee — load-balanced, on-duty only', () => {
  it('skips people on leave', () => {
    const overrides = { u1: { status: 'on_leave' as const } }
    const picked = pickAssignee({ role: 'ase_asm', state: 'Maharashtra', cases: [], overrides })
    expect(picked).not.toBe('u1')
    expect(isUserAvailable(picked!, overrides)).toBe(true)
  })
  it('picks the lightest-loaded member', () => {
    const cases = [base({ code: 'C1', assigneeId: 'u1', ownerRole: 'ase_asm' })]
    const picked = pickAssignee({ role: 'ase_asm', state: 'Maharashtra', cases, overrides: {} })
    expect(picked).not.toBe('u1') // u1 already has a case, another peer is lighter
  })
})

describe('backupFor — honours the chosen delegate', () => {
  it('u-ase-3 (seeded on leave) delegates to its backup u-ase-2', () => {
    expect(backupFor('u-ase-3', [], {})).toBe('u-ase-2')
  })
})

describe('assignSeedCases — stamps case-management fields', () => {
  it('gives every case an assignee, caseType and caseState', () => {
    const out = assignSeedCases([base({ code: 'X1', assigneeId: undefined, ownerRole: 'finance', status: 'flagged' })])
    expect(out[0].assigneeId).toBeTruthy()
    expect(out[0].caseType).toBe('appointment')
    expect(out[0].caseState).toBe('UNDER_REVIEW')
  })
})

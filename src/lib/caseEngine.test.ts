import { describe, it, expect } from 'vitest'
import { TRANSITIONS, STATE_ORDER, TERMINAL_STATES, START_STATE, canTransition, stateLabel, makeEvent } from './caseEngine'

describe('caseEngine — appointment state machine', () => {
  it('starts at SUBMITTED', () => {
    expect(START_STATE.appointment).toBe('SUBMITTED')
  })

  it('allows the runtime lifecycle transitions', () => {
    expect(canTransition('appointment', 'SUBMITTED', 'UNDER_REVIEW')).toBe(true)
    expect(canTransition('appointment', 'UNDER_REVIEW', 'LEADERSHIP_SIGNOFF')).toBe(true)
    expect(canTransition('appointment', 'LEADERSHIP_SIGNOFF', 'ACTIVE')).toBe(true)
    expect(canTransition('appointment', 'SUBMITTED', 'LEADERSHIP_SIGNOFF')).toBe(true) // auto-clear skip
  })

  it('rejects illegal transitions', () => {
    expect(canTransition('appointment', 'ACTIVE', 'UNDER_REVIEW')).toBe(false)
    expect(canTransition('appointment', 'SUBMITTED', 'ACTIVE')).toBe(false)
    expect(canTransition('appointment', 'REJECTED', 'ACTIVE')).toBe(false)
  })

  it('any state can be rejected except terminals', () => {
    expect(canTransition('appointment', 'UNDER_REVIEW', 'REJECTED')).toBe(true)
    expect(canTransition('appointment', 'LEADERSHIP_SIGNOFF', 'REJECTED')).toBe(true)
    expect(TRANSITIONS.appointment.ACTIVE).toEqual([])
  })

  it('marks ACTIVE / REJECTED as terminal', () => {
    expect(TERMINAL_STATES.has('ACTIVE')).toBe(true)
    expect(TERMINAL_STATES.has('REJECTED')).toBe(true)
    expect(TERMINAL_STATES.has('UNDER_REVIEW')).toBe(false)
  })

  it('orders the happy-path states', () => {
    expect(STATE_ORDER.appointment).toEqual(['SUBMITTED', 'UNDER_REVIEW', 'LEADERSHIP_SIGNOFF', 'ACTIVE'])
  })
})

describe('caseEngine — scouting & onboarding', () => {
  it('scouting funnel', () => {
    expect(canTransition('scouting', 'REGISTER', 'SHORTLISTED')).toBe(true)
    expect(canTransition('scouting', 'INTEREST_CHECK', 'HANDED_OFF')).toBe(true)
    expect(canTransition('scouting', 'REGISTER', 'HANDED_OFF')).toBe(false)
  })
  it('onboarding stages', () => {
    expect(canTransition('onboarding', 'APPOINTMENT', 'COMPLETE')).toBe(true)
    expect(canTransition('onboarding', 'COMPLETE', 'APPOINTMENT')).toBe(false)
  })
})

describe('caseEngine — helpers', () => {
  it('labels states', () => {
    expect(stateLabel('UNDER_REVIEW')).toBe('Under Review')
    expect(stateLabel('LEADERSHIP_SIGNOFF')).toBe('Final Sign-off')
    expect(stateLabel(undefined)).toBe('—')
  })
  it('makeEvent stamps a unique id + fields', () => {
    const a = makeEvent({ kind: 'transition', actor: 'X', summary: 's' })
    const b = makeEvent({ kind: 'transition', actor: 'X', summary: 's' })
    expect(a.id).not.toBe(b.id)
    expect(a.kind).toBe('transition')
    expect(a.when).toBeTruthy()
  })
})

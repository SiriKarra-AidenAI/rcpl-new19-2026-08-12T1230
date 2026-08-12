import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CaseRecord, WorkbasketItem } from './types'

// The store persists via localStorage + fetch('/session'); stub both so it imports cleanly in node.
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no backend in test') }))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let useApp: any

const flag = (o: Partial<CaseRecord>): CaseRecord => ({
  code: 'X', partnerName: 'Test Firm', partnerType: 'distributor', town: 'Pune', state: 'Maharashtra',
  subtype: 'new', status: 'flagged', ownerRole: 'finance', slaLabel: '', isOverdue: false,
  hasDiscontinuationForm: true, confidencePct: 90, candidateId: 'cand', ...o,
})

beforeEach(async () => {
  if (!useApp) ({ useApp } = await import('./store'))
  useApp.setState({ flaggedCases: [], candidates: [], partners: [], onboardingCases: [], notifications: [], auditLog: [] })
})

describe('decideCase — L2 clearance routes UP to Leadership (L3), does not activate', () => {
  it('Finance (L2) clearing routes to Leadership; only Leadership (L3) activates', () => {
    useApp.getState().flagCandidateCase(flag({ code: 'A1', ownerRole: 'finance', candidateId: 'c1' }))
    useApp.getState().decideCase('A1', 'approved', 'tester')   // Finance (L2) clears
    let c = useApp.getState().flaggedCases.find((x: CaseRecord) => x.code === 'A1')
    expect(c.status).toBe('flagged')             // NOT approved yet
    expect(c.ownerRole).toBe('leadership')       // handed UP to L3
    expect(c.caseState).toBe('LEADERSHIP_SIGNOFF')
    expect(useApp.getState().onboardingCases.length).toBe(0)   // not activated on L2 clearance

    useApp.getState().decideCase('A1', 'approved', 'leader')   // Leadership (L3) signs off
    c = useApp.getState().flaggedCases.find((x: CaseRecord) => x.code === 'A1')
    expect(c.status).toBe('approved')
    expect(c.caseState).toBe('ACTIVE')
    expect(useApp.getState().onboardingCases.some((o: { parentCaseCode?: string }) => o.parentCaseCode === 'A1')).toBe(true)
  })
})

describe('decideCase — the field team (ASE/ASM) cannot activate a clean case', () => {
  it('an ASM-owned clean case routes to Leadership instead of activating', () => {
    useApp.getState().flagCandidateCase(flag({ code: 'CLEAN', ownerRole: 'asm', autoCleared: true, candidateId: 'c3' }))
    useApp.getState().decideCase('CLEAN', 'approved', 'tester')   // ASM tries to approve
    const c = useApp.getState().flaggedCases.find((x: CaseRecord) => x.code === 'CLEAN')
    expect(c.ownerRole).toBe('leadership')       // routed to L3, not activated
    expect(c.caseState).toBe('LEADERSHIP_SIGNOFF')
    expect(useApp.getState().onboardingCases.length).toBe(0)   // ASM approval did NOT activate
  })
})

describe('decideCase — dual-fail parks, then routes to Leadership, then activates', () => {
  it('first team parks; second routes to L3; Leadership activates', () => {
    useApp.getState().flagCandidateCase(flag({ code: 'F1', ownerRole: 'finance', candidateId: 'c2' }))
    useApp.getState().flagCandidateCase(flag({ code: 'C1', ownerRole: 'channel_dev', candidateId: 'c2' }))

    useApp.getState().decideCase('F1', 'approved', 'tester')   // channel sibling still open → park
    expect(useApp.getState().flaggedCases.find((x: CaseRecord) => x.code === 'F1').status).toBe('approved')
    expect(useApp.getState().onboardingCases.length).toBe(0)   // not activated yet

    useApp.getState().decideCase('C1', 'approved', 'tester')   // last check clear → route to L3
    const c1 = useApp.getState().flaggedCases.find((x: CaseRecord) => x.code === 'C1')
    expect(c1.ownerRole).toBe('leadership')
    expect(useApp.getState().onboardingCases.length).toBe(0)   // still not active

    useApp.getState().decideCase('C1', 'approved', 'leader')   // Leadership (L3) signs off
    expect(useApp.getState().onboardingCases.some((o: { parentCaseCode?: string }) => o.parentCaseCode === 'C1')).toBe(true)
  })
})

describe('checkSlaBreaches — auto-escalation', () => {
  it('escalates an overdue case whose assignee has a manager (ASE → ASM)', () => {
    useApp.getState().flagCandidateCase(flag({ code: 'OD1', ownerRole: 'ase_asm', candidateId: 'c4', slaDueAt: Date.now() - 3600e3 }))
    const before = useApp.getState().flaggedCases.find((x: CaseRecord) => x.code === 'OD1')
    expect(before.escalated).toBeFalsy()
    const n = useApp.getState().checkSlaBreaches()
    const after = useApp.getState().flaggedCases.find((x: CaseRecord) => x.code === 'OD1')
    expect(n).toBeGreaterThanOrEqual(1)
    expect(after.escalated).toBe(true)
  })

  it('does NOT re-escalate an already-escalated case', () => {
    useApp.getState().flagCandidateCase(flag({ code: 'OD2', ownerRole: 'ase_asm', candidateId: 'c5', slaDueAt: Date.now() - 3600e3 }))
    useApp.getState().checkSlaBreaches()
    const n2 = useApp.getState().checkSlaBreaches()  // second sweep
    expect(n2).toBe(0)
  })

  it('KNOWN GAP: an HQ-role case (no manager chain) is NOT auto-escalated', () => {
    useApp.getState().flagCandidateCase(flag({ code: 'OD3', ownerRole: 'finance', candidateId: 'c6', slaDueAt: Date.now() - 3600e3 }))
    const n = useApp.getState().checkSlaBreaches()
    const after = useApp.getState().flaggedCases.find((x: CaseRecord) => x.code === 'OD3')
    expect(after.escalated).toBeFalsy()   // documents the limitation: Finance/Channel/MDM have no manager above
    expect(n).toBe(0)
  })
})

describe('workbasket — pick / assign / advance / flag', () => {
  const wb = (o: Partial<WorkbasketItem>): WorkbasketItem => ({
    id: 'wb1', dbName: 'Test DB', town: 'Pune', state: 'Maharashtra', companyTier: 'Tier 1',
    shortlistedByAseId: 'u1', shortlistedAt: 0, status: 'unclaimed', events: [], ...o,
  })
  const item = (id = 'wb1') => useApp.getState().workbasket.find((x: WorkbasketItem) => x.id === id)

  it('an ASM picking an unclaimed item moves it into their worklist', () => {
    useApp.setState({ workbasket: [wb({ id: 'p1' })] })
    useApp.getState().pickWorkbasketItem('p1', 'u-asm-w', 'D. Kulkarni')
    const i = item('p1')
    expect(i.status).toBe('picked')
    expect(i.ownerId).toBe('u-asm-w')
    expect(i.claimedVia).toBe('pick')
  })

  it('the RBL/ASM assigning an unassigned DB hands it to an ASE and notifies them', () => {
    useApp.setState({ workbasket: [wb({ id: 'a1' })], notifications: [] })
    useApp.getState().assignWorkbasketItem('a1', 'u-ase-4', 'R. Krishnan')
    const i = item('a1')
    expect(i.status).toBe('assigned')
    expect(i.ownerId).toBe('u-ase-4')
    expect(i.claimedVia).toBe('assigned')
    expect(useApp.getState().notifications.some((n: { forRole?: string }) => n.forRole === 'ase_asm')).toBe(true)
  })

  it('advancing walks picked → in_progress → done', () => {
    useApp.setState({ workbasket: [wb({ id: 'g1', status: 'picked', ownerId: 'u-asm-w' })] })
    useApp.getState().advanceWorkbasketItem('g1', 'D. Kulkarni')
    expect(item('g1').status).toBe('in_progress')
    useApp.getState().advanceWorkbasketItem('g1', 'D. Kulkarni')
    expect(item('g1').status).toBe('done')
  })

  it('bulk-assign hands several unassigned DBs to one ASE (skips already-claimed)', () => {
    useApp.setState({ workbasket: [wb({ id: 'b1' }), wb({ id: 'b2' }), wb({ id: 'b3', status: 'assigned', ownerId: 'u1' })], notifications: [] })
    useApp.getState().assignWorkbasketItems(['b1', 'b2', 'b3'], 'u-ase-4', 'R. Krishnan')
    expect(item('b1').ownerId).toBe('u-ase-4')
    expect(item('b1').status).toBe('assigned')
    expect(item('b2').ownerId).toBe('u-ase-4')
    expect(item('b3').ownerId).toBe('u1') // already assigned — left untouched
  })

  it('a picked item cannot be picked again (guarded on unclaimed)', () => {
    useApp.setState({ workbasket: [wb({ id: 'x1', status: 'picked', ownerId: 'u-asm-w' })] })
    useApp.getState().pickWorkbasketItem('x1', 'u-asm-s', 'M. Reddy')
    expect(item('x1').ownerId).toBe('u-asm-w') // unchanged
  })
})

describe('workbasket — on leave flags the owner’s worklist, return clears it', () => {
  it('setting an ASM on leave flags their open items; back on duty clears them', () => {
    useApp.setState({
      workbasket: [{ id: 'l1', dbName: 'DB', town: 'Pune', state: 'Maharashtra', companyTier: 'Tier 1',
        shortlistedByAseId: 'u1', shortlistedAt: 0, status: 'picked', ownerId: 'u-asm-w', events: [] }],
      availabilityByUser: {},
    })
    const item = () => useApp.getState().workbasket.find((x: WorkbasketItem) => x.id === 'l1')
    useApp.getState().setAvailability('u-asm-w', { status: 'on_leave' }, 'V. Menon')
    expect(item().flagged).toBe(true)
    expect(item().ownerId).toBe('u-asm-w') // stays owned — assignment doesn't move on its own
    useApp.getState().setAvailability('u-asm-w', { status: 'on_duty' }, 'V. Menon')
    expect(item().flagged).toBe(false)
  })
})

describe('decideCase — reject', () => {
  it('rejecting sets REJECTED and does not activate', () => {
    useApp.getState().flagCandidateCase(flag({ code: 'R1', ownerRole: 'channel_dev', candidateId: 'c7' }))
    useApp.getState().decideCase('R1', 'rejected', 'tester')
    const c = useApp.getState().flaggedCases.find((x: CaseRecord) => x.code === 'R1')
    expect(c.status).toBe('rejected')
    expect(c.caseState).toBe('REJECTED')
    expect(useApp.getState().onboardingCases.length).toBe(0)
  })
})

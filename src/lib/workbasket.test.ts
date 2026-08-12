import { describe, it, expect } from 'vitest'
import { workbasketStats, worklistFor, contributedBy, unpickedItems, loadByOwner, asesWithNoWork, assignableAses, nextWorkStatus } from './workbasket'
import { INITIAL_WORKBASKET } from '../mock/workbasket'
import type { WorkbasketItem } from '../types'

const item = (over: Partial<WorkbasketItem>): WorkbasketItem => ({
  id: 'wb-x', dbName: 'Test DB', town: 'Pune', state: 'Maharashtra', companyTier: 'Tier 1',
  shortlistedByAseId: 'u1', shortlistedAt: 0, status: 'unclaimed', events: [], ...over,
})

describe('workbasketStats — buckets add up to total', () => {
  it('sums each status and counts flags', () => {
    const items = [
      item({ status: 'unclaimed' }),
      item({ status: 'picked', ownerId: 'u-asm-w' }),
      item({ status: 'assigned', ownerId: 'u-asm-w', flagged: true }),
      item({ status: 'in_progress', ownerId: 'u-asm-s' }),
      item({ status: 'done', ownerId: 'u-asm-s' }),
    ]
    const s = workbasketStats(items)
    expect(s.total).toBe(5)
    expect(s.unclaimed).toBe(1)
    expect(s.picked).toBe(1)
    expect(s.assigned).toBe(1)
    expect(s.inProgress).toBe(1)
    expect(s.done).toBe(1)
    expect(s.flagged).toBe(1)
    expect(s.unclaimed + s.picked + s.assigned + s.inProgress + s.done).toBe(s.total)
  })
})

describe('worklistFor / contributedBy', () => {
  const items = [
    item({ id: 'a', shortlistedByAseId: 'u1', ownerId: 'u-asm-w', status: 'picked' }),
    item({ id: 'b', shortlistedByAseId: 'u1', status: 'unclaimed' }),
    item({ id: 'c', shortlistedByAseId: 'u-ase-2', ownerId: 'u-asm-s', status: 'assigned' }),
  ]
  it('worklistFor returns only that owner’s items', () => {
    expect(worklistFor(items, 'u-asm-w').map((i) => i.id)).toEqual(['a'])
  })
  it('contributedBy returns everything an ASE shortlisted, claimed or not', () => {
    expect(contributedBy(items, 'u1').map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('unpickedItems + loadByOwner', () => {
  const items = [
    item({ id: 'a', status: 'unclaimed' }),
    item({ id: 'b', status: 'picked', ownerId: 'u-asm-w' }),
    item({ id: 'c', status: 'in_progress', ownerId: 'u-asm-w' }),
    item({ id: 'd', status: 'done', ownerId: 'u-asm-w' }),
  ]
  it('unpickedItems = only unclaimed', () => {
    expect(unpickedItems(items).map((i) => i.id)).toEqual(['a'])
  })
  it('loadByOwner counts open items only (excludes done)', () => {
    expect(loadByOwner(items)['u-asm-w']).toBe(2)
  })
})

describe('asesWithNoWork — the RBL/ASM assign targets', () => {
  it('an ASE with zero open items is idle; one carrying work is not', () => {
    const items = [item({ status: 'assigned', ownerId: 'u1' })]
    const idle = asesWithNoWork(items).map((m) => m.id)
    expect(idle).toContain('u-ase-4') // no work → idle target
    expect(idle).not.toContain('u1')  // carrying a DB → not idle
  })
  it('assignableAses lists only ASE-level members (no ASM/SM/RBL)', () => {
    const levels = assignableAses().map((m) => m.level)
    expect(levels.every((l) => l === 'ASE')).toBe(true)
    expect(assignableAses().length).toBeGreaterThanOrEqual(3)
  })
})

describe('nextWorkStatus — progression', () => {
  it('picked/assigned → in_progress → done → null', () => {
    expect(nextWorkStatus('picked')).toBe('in_progress')
    expect(nextWorkStatus('assigned')).toBe('in_progress')
    expect(nextWorkStatus('in_progress')).toBe('done')
    expect(nextWorkStatus('done')).toBeNull()
    expect(nextWorkStatus('unclaimed')).toBeNull()
  })
})

describe('INITIAL_WORKBASKET seed', () => {
  it('is exactly the real scouted candidates from INITIAL_SCOUTING — no fabricated placeholders', () => {
    const s = workbasketStats(INITIAL_WORKBASKET)
    expect(s.total).toBe(5)
    expect(s.unclaimed).toBe(3)
    expect(s.picked).toBe(1)   // Ramkund Traders — R. Malhotra's own pick
    expect(s.assigned).toBe(1) // Shivneri Sales — assigned to K. Bhosale by the RBL
  })
  it('every item is traceable to a real scouting case', () => {
    expect(INITIAL_WORKBASKET.every((i) => !!i.scoutingCaseId && !!i.scoutingCaseCode)).toBe(true)
  })
})

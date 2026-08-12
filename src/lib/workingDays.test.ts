import { describe, it, expect } from 'vitest'
import { addWorkingDays, workingDaysBetween, slaStateFor, slaLabel } from './workingDays'

const isWeekend = (t: number) => { const d = new Date(t).getDay(); return d === 0 || d === 6 }

describe('workingDays', () => {
  const from = new Date(2026, 6, 13).getTime() // 13 Jul 2026 (a Monday)

  it('addWorkingDays never lands on a weekend', () => {
    for (let n = 1; n <= 10; n++) expect(isWeekend(addWorkingDays(from, n))).toBe(false)
  })

  it('addWorkingDays + workingDaysBetween are inverse for n>0', () => {
    for (const n of [1, 2, 5, 7]) {
      expect(workingDaysBetween(from, addWorkingDays(from, n))).toBe(n)
    }
  })

  it('D+2 skips the weekend (Fri + 2 = Tue)', () => {
    const fri = new Date(2026, 6, 17).getTime() // Friday
    const due = addWorkingDays(fri, 2)
    expect(new Date(due).getDay()).toBe(2) // Tuesday
  })

  it('slaStateFor: overdue / due-soon / on-track', () => {
    const now = from
    expect(slaStateFor(now - 86400e3, now)).toBe('overdue')
    expect(slaStateFor(addWorkingDays(now, 1), now)).toBe('due_soon')
    expect(slaStateFor(addWorkingDays(now, 5), now)).toBe('on_track')
  })

  it('slaLabel reads sensibly', () => {
    const now = from
    expect(slaLabel(now - 3 * 86400e3, now)).toContain('Overdue')
    expect(slaLabel(addWorkingDays(now, 3), now)).toBe('3d left')
  })
})

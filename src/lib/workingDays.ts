// Working-day SLA helper. The deck's timelines are calendar-aware ("Day D", "IT code by D+2,
// working days only"), so SLAs count weekdays, not raw hours. Synthetic calendar: Mon–Fri are
// working days, Sat/Sun are skipped. No holiday realism at prototype stage (design D-note).

import type { SlaState } from '../types'

const isWeekend = (d: Date): boolean => d.getDay() === 0 || d.getDay() === 6

/** Epoch `from` plus `n` working days (n can be 0 → next working moment on the same/next weekday). */
export function addWorkingDays(from: number, n: number): number {
  const d = new Date(from)
  let added = 0
  while (added < n) {
    d.setDate(d.getDate() + 1)
    if (!isWeekend(d)) added++
  }
  // If we added 0 days but landed on a weekend anchor, roll forward to the next weekday.
  while (n === 0 && isWeekend(d)) d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** Whole working days between two epochs (negative if `to` is before `from`). */
export function workingDaysBetween(from: number, to: number): number {
  const sign = to >= from ? 1 : -1
  const [a, b] = sign > 0 ? [from, to] : [to, from]
  const d = new Date(a)
  const end = new Date(b)
  let count = 0
  while (d < end) {
    d.setDate(d.getDate() + 1)
    if (!isWeekend(d)) count++
  }
  return sign * count
}

/** SLA state for a deadline relative to now — due-soon fires within one working day of the due date. */
export function slaStateFor(dueAt: number, now: number = Date.now()): SlaState {
  if (now > dueAt) return 'overdue'
  if (workingDaysBetween(now, dueAt) <= 1) return 'due_soon'
  return 'on_track'
}

/** Compact remaining/overdue label, e.g. '2d left' · 'Due today' · 'Overdue 1d'. */
export function slaLabel(dueAt: number, now: number = Date.now()): string {
  const days = workingDaysBetween(now, dueAt)
  if (now > dueAt) return days === 0 ? 'Overdue' : `Overdue ${Math.abs(days)}d`
  if (days === 0) return 'Due today'
  return `${days}d left`
}

export const SLA_TONE: Record<SlaState, 'good' | 'warn' | 'crit'> = {
  on_track: 'good',
  due_soon: 'warn',
  overdue: 'crit',
}

// Live (wall-clock) SLA for a per-case deadline — used by the appointment queue/case detail, where
// the window is short (hours). Due-soon fires within the last 8 hours.
export function liveSlaState(dueAt: number, now: number = Date.now()): SlaState {
  if (now > dueAt) return 'overdue'
  if (dueAt - now <= 8 * 3600e3) return 'due_soon'
  return 'on_track'
}

export function liveSlaLabel(dueAt: number, now: number = Date.now()): string {
  const diff = dueAt - now
  if (diff <= 0) {
    const days = Math.floor(-diff / 86400e3)
    return days > 0 ? `Overdue ${days}d` : `Overdue ${Math.max(1, Math.floor(-diff / 3600e3))}h`
  }
  const hours = diff / 3600e3
  return hours < 24 ? `${Math.ceil(hours)}h left` : `${Math.ceil(hours / 24)}d left`
}

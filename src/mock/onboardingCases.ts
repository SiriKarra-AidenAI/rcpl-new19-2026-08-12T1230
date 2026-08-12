// Onboarding cases (deck slides 5 & 8, collapsed to just Appointment + Complete). Spawned when a
// DB is activated; DB Code creation is the only real step — once IT creates it, the case is done
// and the partner simply sits in Partners. One seed case so the screen isn't empty before any
// activation.

import { makeEvent } from '../lib/caseEngine'
import type { OnboardingCase } from '../types'

/** Stage → nominal duration in days. */
export const ONBOARDING_STAGE_DAYS: Record<string, number> = {
  APPOINTMENT: 7, COMPLETE: 0,
}

/** Stage → owning role. IT owns the case for its whole (now much shorter) life. */
export const ONBOARDING_STAGE_OWNER: Record<string, string> = {
  APPOINTMENT: 'IT (DB Code)', COMPLETE: 'IT',
}

// Godavari Traders is a real, long-standing partner (mock/cases.ts's p7 — dbCode DB-1007, active
// since 2022), so this seed links to it directly via partnerId rather than floating disconnected.
export const INITIAL_ONBOARDING: OnboardingCase[] = [
  {
    id: 'onb-godavari', code: 'ONB-7001', partnerName: 'Godavari Traders', town: 'Nashik', state: 'Maharashtra',
    ownerRole: 'it', assigneeId: 'u7', caseState: 'COMPLETE', startAt: Date.parse('2026-07-12'),
    partnerId: 'p7',
    events: [makeEvent({ kind: 'created', actor: 'System', summary: 'Onboarding opened — agreement signed, DB Code DB-1007 created, now sitting in Partners' })],
  },
]

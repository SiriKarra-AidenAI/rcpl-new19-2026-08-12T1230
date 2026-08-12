// Seed scouting cases (deck slide 4). A scouting case opens when a 30-day termination notice
// lands (Day D), runs a 7-working-day shortlisting funnel, and hands off ≤3 candidates to the
// appointment stage. Candidate firms here are prospects being scouted — deliberately distinct
// from the app's existing partners.

import { addWorkingDays } from '../lib/workingDays'
import { makeEvent } from '../lib/caseEngine'
import type { ScoutingCase } from '../types'

const d = (s: string) => Date.parse(s)

export const INITIAL_SCOUTING: ScoutingCase[] = [
  {
    id: 'sct-nashik', code: 'SCT-4001', area: 'Nashik', state: 'Maharashtra', townClass: 'Up to FLP',
    reason: '30-day termination notice', ownerRole: 'ase_asm', assigneeId: 'u1',
    caseState: 'SHORTLISTED', dayD: d('2026-07-14'), slaDueAt: addWorkingDays(d('2026-07-14'), 7),
    candidates: [
      { id: 'sc1', name: 'Trimbak Distributors', town: 'Nashik', companyTier: 'Tier 1', competingBrand: false, retailerFeedback: [] },
      { id: 'sc2', name: 'Panchvati Agencies', town: 'Nashik', companyTier: 'Tier 2', competingBrand: false, retailerFeedback: [] },
      { id: 'sc3', name: 'Ramkund Traders', town: 'Nashik', companyTier: 'Tier 2', competingBrand: true, retailerFeedback: [] },
    ],
    events: [makeEvent({ kind: 'created', actor: 'Scouting Agent', summary: 'Scouting opened — 30-day termination notice served (Day D). 7-working-day SLA started.' })],
  },
  {
    id: 'sct-pune', code: 'SCT-4002', area: 'Pune', state: 'Maharashtra', townClass: 'Up to FLP',
    reason: 'New market opportunity', ownerRole: 'ase_asm', assigneeId: 'u-ase-2',
    caseState: 'RETAILER_FEEDBACK', dayD: d('2026-07-16'), slaDueAt: addWorkingDays(d('2026-07-16'), 7),
    candidates: [
      { id: 'sc4', name: 'Shivneri Sales', town: 'Pune', companyTier: 'Tier 1', competingBrand: false,
        retailerFeedback: [{ retailer: 'SAMT', service: 4, credit: 5 }, { retailer: 'WS', service: 4, credit: 4 }] },
      { id: 'sc5', name: 'Deccan Gateway Traders', town: 'Pune', companyTier: 'Tier 2', competingBrand: false, retailerFeedback: [] },
    ],
    events: [makeEvent({ kind: 'created', actor: 'Scouting Agent', summary: 'Scouting opened — new market opportunity in Pune. 7-working-day SLA started.' })],
  },
]

/** The company tier required for a town class (slide 4): up to FLP → Tier 1&2; below FLP → Tier 2&3. */
export const requiredTiers = (townClass: ScoutingCase['townClass']): ScoutCandidateTier[] =>
  townClass === 'Up to FLP' ? ['Tier 1', 'Tier 2'] : ['Tier 2', 'Tier 3']

type ScoutCandidateTier = 'Tier 1' | 'Tier 2' | 'Tier 3'

export const MAX_ADVANCE = 3

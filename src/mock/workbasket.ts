// Seed workbasket (db-workbasket). Every entry here is a REAL scouted candidate carried over
// from an actual ScoutingCase (mock/scouting.ts) — not a fabricated placeholder. An earlier
// version of this file padded each ASE's block out to ~15 invented names with no candidate
// backing them anywhere else in the system; once one of those was picked up and bridged into a
// lead (see leadFromWorkbasketDb in store.ts), it had nothing real behind it — every field had
// to be guessed off a name hash. Now the pool is exactly what Scouting has actually shortlisted,
// so a lead built from it reflects a real, already-on-record candidate (town, tier, competing-
// brand flag, retailer feedback). Deterministic: timestamps are fixed offsets off each scouting
// case's own Day-D, no Date.now()/random at module load.

import { makeEvent } from '../lib/caseEngine'
import { INITIAL_SCOUTING } from './scouting'
import type { WorkbasketItem } from '../types'

const memberName = (id: string): string => ({
  u1: 'R. Malhotra', 'u-ase-2': 'K. Bhosale', 'u-ase-3': 'A. Joshi', 'u-ase-4': 'N. Rao', 'u-rbl': 'R. Krishnan',
} as Record<string, string>)[id] ?? id

const RBL = 'u-rbl'
// Claim state, keyed by ScoutCandidate id — every other candidate stays unclaimed in the pool
// for the RBL/ASM to hand out (mirrors a real shortlist: candidates sit there until picked).
const CLAIMS: Record<string, { ownerId: string; via: 'pick' | 'assigned'; assignedById?: string }> = {
  sc3: { ownerId: 'u1', via: 'pick' },                            // Ramkund Traders — already in R. Malhotra's own worklist
  sc4: { ownerId: 'u-ase-2', via: 'assigned', assignedById: RBL }, // Shivneri Sales — handed to K. Bhosale by the RBL
}

function build(): WorkbasketItem[] {
  const items: WorkbasketItem[] = []
  let n = 0
  for (const sc of INITIAL_SCOUTING) {
    for (const c of sc.candidates) {
      const shortlistedAt = sc.dayD + n * 3600e3
      const aseName = memberName(sc.assigneeId ?? '')
      const events = [makeEvent({
        kind: 'created', actor: aseName, at: shortlistedAt,
        summary: `Shortlisted by ${aseName} from ${sc.code} (${sc.area}) — added to the DB Pool`,
      })]
      const item: WorkbasketItem = {
        id: `wb-${c.id}`, dbName: c.name, town: c.town, state: sc.state, companyTier: c.companyTier,
        scoutingCaseId: sc.id, scoutingCaseCode: sc.code,
        shortlistedByAseId: sc.assigneeId ?? '', shortlistedAt, status: 'unclaimed', events,
      }
      const claim = CLAIMS[c.id]
      if (claim) {
        const claimedAt = shortlistedAt + 2 * 3600e3
        item.status = claim.via === 'pick' ? 'picked' : 'assigned'
        item.ownerId = claim.ownerId
        item.claimedAt = claimedAt
        item.claimedVia = claim.via
        item.assignedById = claim.assignedById
        item.events.push(makeEvent({
          kind: 'assigned', actor: claim.via === 'assigned' ? memberName(claim.assignedById ?? RBL) : memberName(claim.ownerId), at: claimedAt,
          summary: claim.via === 'assigned'
            ? `Assigned to ${memberName(claim.ownerId)} by ${memberName(claim.assignedById ?? RBL)} (RBL)`
            : `Picked into ${memberName(claim.ownerId)}'s worklist`,
        }))
      }
      items.push(item)
      n++
    }
  }
  return items
}

export const INITIAL_WORKBASKET: WorkbasketItem[] = build()

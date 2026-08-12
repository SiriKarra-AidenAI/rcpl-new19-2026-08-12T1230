// Banded Visit-Contact + Approval matrix and the day-based SLA (deck slides 6 & 7). Authority is a
// DATA table keyed by expected monthly turnover, not hard-coded thresholds — tunable and testable.

export interface AuthorityBand {
  label: string
  maxTurnoverL: number        // upper bound (₹L); Infinity = top band
  recommend: string
  finalise: string
  l1: string                  // L1 approver
  l2: string                  // L2 approver
}

export const AUTHORITY_BANDS: AuthorityBand[] = [
  { label: '< ₹10 L', maxTurnoverL: 10, recommend: 'ASE', finalise: 'ASE', l1: 'Channel Mgmt Lead', l2: '—' },
  { label: '₹10–50 L', maxTurnoverL: 50, recommend: 'ASE', finalise: 'ASM', l1: 'Channel Mgmt Lead', l2: 'Finance Controller' },
  { label: '> ₹50 L', maxTurnoverL: Infinity, recommend: 'ASE', finalise: 'ASM + SM/RBL', l1: 'Channel Mgmt Lead', l2: 'Finance Controller' },
]

export function authorityFor(turnoverL: number): AuthorityBand {
  return AUTHORITY_BANDS.find((b) => turnoverL <= b.maxTurnoverL) ?? AUTHORITY_BANDS[AUTHORITY_BANDS.length - 1]
}

/** Day-based SLA (working days), anchored to Day D (notice served/received). */
export const SLA_CONFIG = {
  anchor: 'Day D',
  approvalsDue: 'D',      // recommendation + both approvals land on Day D
  itCodeDue: 'D+2',       // IT creates the code by D+2 working days
  unit: 'working days',
}

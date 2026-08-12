// ROI / potential + gate helpers (deck slide 3 "commitment of 18–20%" and slide 13 "≥20% RCPL
// contribution"). Pure, deterministic — the AI never does the math (backend-plan D4).

export const ROI_TARGET_MIN = 18       // % — deck's 18–20% committed return
export const CONTRIBUTION_MIN = 20     // % — RCPL's minimum share of the DB's overall business

/** Return on the DB's investment: annualised RCPL business × assumed net margin ÷ investment. */
export function computeRoi(expectedRcplTurnoverLPerMonth: number, requiredInvestmentL: number, netMarginPct = 6): number {
  if (requiredInvestmentL <= 0) return 0
  const annualReturn = expectedRcplTurnoverLPerMonth * 12 * (netMarginPct / 100)
  return Math.round((annualReturn / requiredInvestmentL) * 100)
}

export const roiOk = (roiPct: number): boolean => roiPct >= ROI_TARGET_MIN
export const contributionOk = (contributionPct: number): boolean => contributionPct >= CONTRIBUTION_MIN

/** RCPL's share of the DB's overall business (workbook C23 = C22/C21), as a percentage. */
export function contributionPctFor(totalTurnoverL: number, expectedRcplTurnoverL: number): number {
  if (totalTurnoverL <= 0) return 0
  return Math.round((expectedRcplTurnoverL / totalTurnoverL) * 1000) / 10
}

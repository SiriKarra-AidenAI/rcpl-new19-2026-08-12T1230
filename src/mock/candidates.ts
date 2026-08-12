// Candidate pipeline for New Application — replaces the old fixed DB1/DB2/DB3 slots.
import type { CandidateCard, CandidateStage, RoleCode } from '../types'
import { DEMO_PARTNERS } from './cases'
import { SCORED_INFRA_KEYS, requiredInvestmentFor } from './onboarding'

// "Is this lead mine" — two ASEs share the same RoleCode, so a straight createdBy===role
// check can't tell them apart and one ASE ends up seeing another ASE's leads. Prefer the real
// per-person createdById once it's set; only fall back to the role match for candidates seeded
// before that field existed.
export function isMyLead(c: CandidateCard, myId: string | undefined, viewingAs: RoleCode): boolean {
  if (c.createdById != null) return !!myId && c.createdById === myId
  return c.createdBy === viewingAs
}

// Real, per-factor infra scores (not all-identical) that genuinely average to the candidate's
// infraScore, and a real Own Funds/CC Limit split that genuinely sums to their finEvalPct — both
// deterministic off a seed (no Math.random) so every candidate has an honest, distinct breakdown
// instead of New Application having to fabricate one (8 identical sliders, a fixed 60/40 split).
// Only the 7 SCORED_INFRA_KEYS are forced to sum to avgScore — Reputation is generated too (for a
// non-blank slider) but, like the workbook, isn't counted in the average, so it's never adjusted.
function deriveInfraFactors(avgScore: number, seed: number): Record<string, number> {
  const base = Math.round(avgScore)
  const vals = SCORED_INFRA_KEYS.map((_, i) => Math.max(1, Math.min(10, base + (((seed + i * 7) % 5) - 2))))
  const target = Math.round(avgScore * SCORED_INFRA_KEYS.length)
  vals[vals.length - 1] = Math.max(1, Math.min(10, vals[vals.length - 1] + (target - vals.reduce((a, b) => a + b, 0))))
  const reputation = Math.max(1, Math.min(10, base + ((seed % 5) - 2)))
  return { ...Object.fromEntries(SCORED_INFRA_KEYS.map((k, i) => [k, vals[i]])), reputation }
}
function deriveFinance(finEvalPct: number, seed: number, turnoverMonthly: number, expectedRcplTurnover: number): { ownFunds: number; ccLimit: number } {
  const total = Math.round((finEvalPct / 100) * requiredInvestmentFor(turnoverMonthly, expectedRcplTurnover))
  const ownShare = 0.5 + (seed % 30) / 100 // 50–79% of capital as own funds, rest as CC limit
  const ownFunds = Math.max(0, Math.min(200, Math.round(total * ownShare)))
  const ccLimit = Math.max(0, Math.min(150, total - ownFunds))
  return { ownFunds, ccLimit }
}
const seedOf = (s: string) => s.split('').reduce((a, c) => a + c.charCodeAt(0), 0)

export const CANDIDATE_STAGES: { id: CandidateStage; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'pending', label: 'Pending' },
  { id: 'approval_1', label: 'Approval 1' },
  { id: 'approval_2', label: 'Approval 2' },
  { id: 'active', label: 'Active' },
  { id: 'rejected', label: 'Rejected' },
]

// Ideal DB is the benchmark for the territory's coverage plan, not a real candidate.
// infraScore kept at 8.0 (not a perfect 10) — even the benchmark reflects a realistic, achievable
// distributor profile rather than a theoretical max. expectedRcplTurnover follows the ~20.5%
// RCPL-contribution ratio observed in real candidates (e.g. Suvarna: 41/200).
export const IDEAL_DB = { turnoverMonthly: 220, expectedRcplTurnover: 45, coverageOutlets: 1200, infraScore: 8.0 }

// All candidates start life at "Open" — nothing has been evaluated yet when a case is first opened.
// Stage only moves forward when a human explicitly advances it from the Candidates step, after scoring.
export const INITIAL_CANDIDATES: CandidateCard[] = [
  {
    id: 'c1', name: 'Suvarna Agencies', town: 'Nashik', dbCategory: 'GT DB (with CSO/DSM)',
    turnoverMonthly: 200, expectedRcplTurnover: 41, coverageOutlets: 1200,
    infraScore: 8.0, finEvalPct: 138, stage: 'open', confidencePct: 92, isBestMatch: true,
    infraFactors: { salesmen: 8, delivery: 8, godown: 7, computer: 9, reputation: 8, coverage: 7, credit: 9, involvement: 8 },
    ownFunds: 120, ccLimit: 80,
  },
  {
    id: 'c2', name: 'Om Sai Distributors', town: 'Nashik', dbCategory: 'GT DB (with CSO/DSM)',
    turnoverMonthly: 168, expectedRcplTurnover: 32, coverageOutlets: 960,
    infraScore: 6.5, finEvalPct: 97, stage: 'open', confidencePct: 74,
    infraFactors: { salesmen: 7, delivery: 6, godown: 6, computer: 7, reputation: 6, coverage: 7, credit: 6, involvement: 7 },
    ownFunds: 90, ccLimit: 50,
  },
  {
    id: 'c3', name: 'Krishna Trading Co.', town: 'Nashik', dbCategory: 'Traders',
    turnoverMonthly: 140, expectedRcplTurnover: 28, coverageOutlets: 800,
    infraScore: 7.0, finEvalPct: 83, stage: 'open', confidencePct: 61,
    infraFactors: { salesmen: 7, delivery: 7, godown: 6, computer: 8, reputation: 7, coverage: 6, credit: 8, involvement: 7 },
    ownFunds: 70, ccLimit: 50,
  },
]

// Business figures for the directory distributors, so the "Add a lead" picker can offer the
// SAME partners that appear in the Partner directory (keyed by their legal name).
export const LEAD_FIN: Record<string, { dbCategory: string; turnoverMonthly: number; expectedRcplTurnover: number; coverageOutlets: number; infraScore: number; finEvalPct: number; confidencePct: number }> = {
  'Surat Stockists Pvt Ltd': { dbCategory: 'GT DB (with CSO/DSM)', turnoverMonthly: 190, expectedRcplTurnover: 38, coverageOutlets: 1850, infraScore: 8, finEvalPct: 120, confidencePct: 90 },
  'Deccan Trade Links': { dbCategory: 'GT DB (with CSO/DSM)', turnoverMonthly: 168, expectedRcplTurnover: 32, coverageOutlets: 960, infraScore: 6.5, finEvalPct: 97, confidencePct: 74 },
  'Malhotra Distributors': { dbCategory: 'GT DB (with CSO/DSM)', turnoverMonthly: 200, expectedRcplTurnover: 41, coverageOutlets: 1200, infraScore: 8, finEvalPct: 138, confidencePct: 92 },
  'Godavari Traders': { dbCategory: 'Traders', turnoverMonthly: 150, expectedRcplTurnover: 30, coverageOutlets: 900, infraScore: 7, finEvalPct: 100, confidencePct: 80 },
  'Deshmukh Enterprises': { dbCategory: 'GM Excl DB', turnoverMonthly: 120, expectedRcplTurnover: 24, coverageOutlets: 780, infraScore: 6.5, finEvalPct: 90, confidencePct: 66 },
  'Andheri General Stores': { dbCategory: 'GT DB (with CSO/DSM)', turnoverMonthly: 260, expectedRcplTurnover: 52, coverageOutlets: 1400, infraScore: 8.5, finEvalPct: 145, confidencePct: 94 },
  'Suvarna Agencies': { dbCategory: 'GT DB (with CSO/DSM)', turnoverMonthly: 200, expectedRcplTurnover: 41, coverageOutlets: 1200, infraScore: 8, finEvalPct: 138, confidencePct: 92 },
  'Juhu Distributors': { dbCategory: 'GT DB (with CSO/DSM)', turnoverMonthly: 200, expectedRcplTurnover: 40, coverageOutlets: 1050, infraScore: 7.5, finEvalPct: 120, confidencePct: 82 },
}
const leadSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

// Deterministic stand-in figures (seeded off the legal name — no Math.random) for an in-review
// distributor that isn't hand-curated in LEAD_FIN above. Without this, any distributor added to
// the Partner directory later silently vanished from the "Add a lead" picker the moment LEAD_FIN
// wasn't updated to match — which is exactly what happened (9 of 11 in-review distributors had no
// entry). Every in-review distributor must be addable; LEAD_FIN just gives the curated few nicer
// numbers.
function fallbackFin(name: string): typeof LEAD_FIN[string] {
  const seed = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return {
    dbCategory: 'GT DB (with CSO/DSM)',
    turnoverMonthly: 100 + (seed % 120),
    expectedRcplTurnover: 20 + (seed % 25),
    coverageOutlets: 500 + (seed % 1200),
    infraScore: Math.round((5 + (seed % 40) / 10) * 10) / 10,
    finEvalPct: 70 + (seed % 60),
    confidencePct: 55 + (seed % 40),
  }
}

// The "Add a lead" pool = every distributor partner from the directory still awaiting onboarding.
// Excludes 'active' (already onboarded — appointing them again would be a duplicate application)
// and 'discontinued', so the picker and the Partner directory stay one and the same. LEAD_FIN
// gives a curated few nicer figures; every other in-review distributor still gets a deterministic
// fallback rather than being silently dropped.
export const DIRECTORY_LEADS: CandidateCard[] = DEMO_PARTNERS
  .filter((p) => p.partnerType === 'distributor' && p.status === 'in_review')
  .map((p) => {
    const f = LEAD_FIN[p.legalName] ?? fallbackFin(p.legalName)
    const seed = seedOf(p.legalName)
    return {
      id: `dist-${leadSlug(p.legalName)}`, name: p.legalName, town: p.town, dbCategory: f.dbCategory,
      turnoverMonthly: f.turnoverMonthly, expectedRcplTurnover: f.expectedRcplTurnover, coverageOutlets: f.coverageOutlets,
      infraScore: f.infraScore, finEvalPct: f.finEvalPct, stage: 'open' as const, confidencePct: f.confidencePct,
      infraFactors: deriveInfraFactors(f.infraScore, seed), ...deriveFinance(f.finEvalPct, seed, f.turnoverMonthly, f.expectedRcplTurnover),
    }
  })

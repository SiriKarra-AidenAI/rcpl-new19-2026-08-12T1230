import { describe, it, expect } from 'vitest'
import { computeRoi, roiOk, contributionOk, ROI_TARGET_MIN, CONTRIBUTION_MIN } from './roi'
import { authorityFor } from '../mock/authorityMatrix'

describe('roi', () => {
  it('computes annualised ROI on investment', () => {
    // 41L/mo × 12 × 6% ÷ 144.6L ≈ 20%
    expect(computeRoi(41, 144.6, 6)).toBe(20)
  })
  it('returns 0 when investment is 0', () => {
    expect(computeRoi(41, 0)).toBe(0)
  })
  it('gates', () => {
    expect(roiOk(ROI_TARGET_MIN)).toBe(true)
    expect(roiOk(ROI_TARGET_MIN - 1)).toBe(false)
    expect(contributionOk(CONTRIBUTION_MIN)).toBe(true)
    expect(contributionOk(CONTRIBUTION_MIN - 0.1)).toBe(false)
  })
})

describe('authorityMatrix — banded by turnover', () => {
  it('maps turnover to the right band', () => {
    expect(authorityFor(8).finalise).toBe('ASE')
    expect(authorityFor(30).finalise).toBe('ASM')
    expect(authorityFor(80).finalise).toBe('ASM + SM/RBL')
  })
  it('boundaries are inclusive of the upper bound', () => {
    expect(authorityFor(10).label).toBe('< ₹10 L')
    expect(authorityFor(50).label).toBe('₹10–50 L')
    expect(authorityFor(50.01).label).toBe('> ₹50 L')
  })
})

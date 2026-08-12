import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseLeadExcelAll } from './excelLead'

function fakeFile(rows: (string | number)[][]): File {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Leads')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return { arrayBuffer: async () => buf } as unknown as File
}

// Wraps the ACTUAL real workbook's bytes (repo root, also served from public/ for download) —
// not a re-derived stand-in — so this test proves the parser reads the real file, not an
// approximation of it. Dynamic `fs` import (cast to avoid needing @types/node just for this)
// since this project has no other Node-builtin usage in its source.
async function realWorkbookFile(): Promise<File> {
  // @ts-expect-error no @types/node in this project — this is the only Node-builtin usage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = (await import('fs')) as any
  const buf = fs.readFileSync(new URL('../../New DB Appointment Module - RCPL v1.xlsb', import.meta.url))
  return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } as unknown as File
}

describe('excelLead — header-row layout parses every row', () => {
  it('maps columns to fields for each data row', async () => {
    const f = fakeFile([
      ['Firm / Agency Name', 'Contact Person', 'Phone', 'Email', 'Town', 'State', 'DB Type', 'Turnover (₹L/mo)', 'GST', 'Application Type'],
      ['Vaibhav Sales Corp', 'Mr. Kale', '+91 98765 41200', 'v@x.com', 'Solapur', 'Maharashtra', 'GT DB (with CSO/DSM)', 185, '27AACCV1029H1Z5', 'New DB'],
      ['Meghdoot Traders', 'Mr. Agrawal', '+91 90390 55712', 'm@x.com', 'Indore', 'Madhya Pradesh', 'GM Excl DB', 150, '23AAECM4471P1Z8', 'Additional DB'],
    ])
    const leads = await parseLeadExcelAll(f)
    expect(leads).toHaveLength(2)
    expect(leads[0].firmName).toBe('Vaibhav Sales Corp')
    expect(leads[0].turnover).toBe('185')
    expect(leads[0].gst).toBe('27AACCV1029H1Z5')
    expect(leads[0].dbCategory).toBe('GT DB (with CSO/DSM)')
    expect(leads[1].dbSubtype).toBe('Additional DB')
  })
})

describe('excelLead — the real "New DB Appointment Module - RCPL v1" workbook parses end to end', () => {
  it('finds the Appointment Recommendation Form sheet (not the checklist tab) and reads every field it carries', async () => {
    const leads = await parseLeadExcelAll(await realWorkbookFile())
    expect(leads).toHaveLength(1)
    const l = leads[0]
    // Basic Information
    expect(l.dbCategory).toBe('GT DB (with CSO/DSM)')
    expect(l.dbSubtype).toBe('Additional DB')
    expect(l.workingCapital).toBeUndefined() // blank in this particular filled copy
    // Background Information
    expect(l.turnover).toBe('200')
    expect(l.expectedRcplTurnover).toBe('41')
    expect(l.rcplContributionPct).toBe('20.5') // stored as the fraction 0.205
    // Coverage Data
    expect(l.wsContributionPct).toBe('50') // stored as the fraction 0.5
    expect(l.rcplPlannedCoverage).toBe('1200')
    // Infrastructure for Distribution — real per-factor scores, not a flat guess
    expect(l.infra?.salesmen).toBe(8)
    expect(l.infra?.delivery).toBe(8)
    expect(l.infra?.godown).toBe(8)
    expect(l.infra?.computer).toBe(8)
    expect(l.infra?.coverage).toBe(8)
    expect(l.infra?.credit).toBe(8)
    expect(l.infra?.involvement).toBe(8)
    // Financials
    expect(l.ownFunds).toBe('120')
    expect(l.ccLimit).toBe('80')
  }, 20000) // the real file is a 5MB .xlsb — parsing it genuinely takes a few seconds
})

describe('excelLead — a value that happens to fuzzy-match an unrelated field does not derail the parse', () => {
  it('does not mistake "New DB" (the dbSubtype VALUE) for a second header column', async () => {
    // Reproduces a real filled-in copy of the workbook's key/value layout: the "New DB
    // (new town opening) / Replacement DB / Additional DB (in same town)" label's own value,
    // "New DB", fuzzy-matches dbCategory's "newdbtype" synonym (both start with "newdb") — which
    // used to make this look like a 2-header-column row and wrongly flip the whole sheet into
    // (broken) header-row mode, losing every other field including the firm name.
    const f = fakeFile([
      ['', 'SM Name', 'V. Menon'],
      ['', 'ASE Name', 'R. Malhotra'],
      ['', 'New DB Type', 'GT DB (with CSO/DSM)'],
      ['', 'New DB (new town opening) / Replacement DB / Additional DB (in same town)', 'New DB'],
      ['', 'Agency / Firm name', 'Mountain Peak Traders'],
      ['', 'Total Monthly Turnover (in Rs Lacs) of the Firm', 180],
    ])
    const leads = await parseLeadExcelAll(f)
    expect(leads).toHaveLength(1)
    expect(leads[0].firmName).toBe('Mountain Peak Traders')
    expect(leads[0].smName).toBe('V. Menon')
    expect(leads[0].aseName).toBe('R. Malhotra')
    expect(leads[0].dbCategory).toBe('GT DB (with CSO/DSM)')
    expect(leads[0].dbSubtype).toBe('New DB')
    expect(leads[0].turnover).toBe('180')
  })
})

describe('excelLead — key/value layout parses one lead', () => {
  it('reads field | value rows', async () => {
    const f = fakeFile([
      ['Field', 'Value'],
      ['Firm / Agency Name', 'Yashoda Distributors'],
      ['Town / City', 'Amravati'],
      ['GST Number', '27AALCY2201N1Z3'],
      ['Turnover (₹L/mo)', 140],
    ])
    const leads = await parseLeadExcelAll(f)
    expect(leads).toHaveLength(1)
    expect(leads[0].firmName).toBe('Yashoda Distributors')
    expect(leads[0].town).toBe('Amravati')
    expect(leads[0].turnover).toBe('140')
  })
})

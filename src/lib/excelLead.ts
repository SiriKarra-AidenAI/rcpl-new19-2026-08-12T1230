// Parse an uploaded Excel/CSV lead sheet into the same fields the email extractor captures, so a
// manually-received spreadsheet can auto-populate the Create-a-lead form. The primary target is
// the REAL "New DB Appointment Module - RCPL v1" workbook's own "Appointment Recommendation Form"
// sheet — a label/value form (field name in one column, value in the next non-blank column to its
// right; not a header-row table). A plain header-row sheet (one row per lead) or a simple two-
// column "field | value" sheet both still work, for a quick bulk import outside the real workbook.
// Field names are matched loosely (case/spacing/punctuation-insensitive) against known synonyms.

import * as XLSX from 'xlsx'
import { DB_TYPES, SCORED_INFRA_KEYS } from '../mock/onboarding'
import type { DbCategory, InfraState } from '../mock/onboarding'

// The real workbook's own sheet name for its recommendation form — everything else in that file
// (a personal checklist tab, the Discontinuation Form, a "do not delete" tab) isn't lead data.
const RECOMMENDATION_SHEET = /appointment.*recommendation/i

export interface ParsedLead {
  // Basic Information — who in the field scouted/recommended this DB, not who's uploading.
  smName?: string
  asmName?: string
  aseName?: string
  firmName?: string
  contactPerson?: string
  phone?: string
  email?: string
  town?: string
  state?: string
  dbCategory?: DbCategory
  partnerType?: 'distributor' | 'vendor'
  dbSubtype?: 'New DB' | 'Replacement DB' | 'Additional DB'
  oldDbCode?: string
  additionalReason?: string
  workingCapital?: string
  gst?: string
  // Background Information
  companiesHandled?: string
  agencySince?: string
  turnover?: string              // Total Monthly Turnover of the Firm, ₹L
  expectedRcplTurnover?: string  // ₹L/mo
  rcplContributionPct?: string  // % of the firm's overall business
  // Coverage Data
  overallCoverage?: string       // total outlets, all companies
  wsContributionPct?: string
  rcplPlannedCoverage?: string
  // Infrastructure for Distribution (1-10 each) — keys match InfraState/SCORED_INFRA_KEYS exactly.
  infra?: Partial<InfraState>
  // Financials
  ownFunds?: string  // ₹L
  ccLimit?: string   // ₹L
  disengagementFilled?: boolean
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

type PlainField = Exclude<keyof ParsedLead, 'infra' | 'dbCategory' | 'partnerType' | 'dbSubtype' | 'disengagementFilled'>
type InfraField = `infra:${keyof InfraState}`
type Field = PlainField | 'dbCategory' | 'partnerType' | 'dbSubtype' | 'disengagementFilled' | InfraField

// Synonyms per field, normalized (no spaces/punctuation). The long, exact-header entries are the
// real workbook's own column/label text verbatim, normalized — the short ones are looser synonyms
// for a hand-rolled header-row sheet that doesn't use the workbook's exact wording.
const SYN: Record<Field, string[]> = {
  smName: ['smname', 'salesmanager', 'salesmanagername'],
  asmName: ['asmname', 'areasalesmanager', 'areasalesmanagername'],
  aseName: ['asename', 'areasalesexecutive', 'areasalesexecutivename'],
  firmName: ['firm', 'firmname', 'agency', 'agencyname', 'firmagencyname', 'firmagency', 'companyname', 'company', 'distributorname', 'partyname', 'nameoffirm'],
  contactPerson: ['contactperson', 'contact', 'contactname', 'contactpersonname', 'proprietor', 'owner', 'personname'],
  phone: ['phone', 'phonenumber', 'phoneno', 'mobile', 'mobileno', 'mobilenumber', 'contactnumber', 'contactno'],
  email: ['email', 'emailaddress', 'emailid', 'mail'],
  town: ['town', 'city', 'towncity', 'citytown', 'location', 'place'],
  state: ['state'],
  dbCategory: ['dbtype', 'dbtyperequested', 'distributortype', 'dbcategory', 'newdbtype'],
  partnerType: ['partnertype'],
  dbSubtype: [
    'newdbreplacementadditionaldb', 'newdbreplacementadditional', 'newreplacementadditional', 'applicationtype', 'dbstatus', 'leadtype',
    'newdbnewtownopeningreplacementdbadditionaldbinsametown',
  ],
  oldDbCode: ['olddbcode', 'ifreplacementmentionolddbcode', 'ifreplacementolddbcode', 'oldcode', 'previousdbcode', 'replacingdbcode'],
  additionalReason: ['ifadditionaldbmentionreason', 'additionalreason', 'reasonforadditionaldb', 'additionaldbreason'],
  // The workbook's own working-capital input (turnover ÷ 30 × 18 working-capital days — see
  // requiredInvestmentFor's doc comment in mock/onboarding.ts) — captured as given, not
  // recomputed, since the sheet may carry the firm's own stated figure.
  workingCapital: ['workingcapitalrequiredforbusiness', 'workingcapitalrequired', 'workingcapital'],
  gst: ['gst', 'gstnumber', 'gstno', 'gstin'],
  companiesHandled: ['companieshandlednameofcompanies', 'companieshandled'],
  agencySince: ['agencysincenoofyears', 'agencysince', 'yearsinbusiness'],
  turnover: ['turnover', 'turnoverclaim', 'monthlyturnover', 'expectedturnover', 'turnoverclaimrmo', 'turnoverrmo', 'turnovermonthly', 'monthlyturnoverrs', 'turnoverrs', 'turnoverl',
    'totalmonthlyturnoverinrslacsofthefirm', 'totalmonthlyturnoveroffirm'],
  expectedRcplTurnover: ['expectedrcplturnoverinrslacspermonth', 'expectedrcplturnover'],
  rcplContributionPct: ['rcplcontibutiontooverallbusiness', 'rcplcontributiontooverallbusiness'],
  overallCoverage: ['overallfirmscoverageallcompaniesputtogethertotalolcount', 'overallcoverage', 'totaloutletcount'],
  wsContributionPct: ['wscontributiontohisbusinessmentioninpercentage', 'wscontribution'],
  rcplPlannedCoverage: ['rcplplannedcoverage'],
  ownFunds: ['totalownfundsborrowedinrslacs', 'ownfunds', 'ownfundsborrowed'],
  ccLimit: ['cclimitinrslacs', 'cclimit', 'cashcreditlimit'],
  disengagementFilled: ['disengagementformfilledornotincaseofreplacementdb', 'disengagementformfilled'],
  'infra:salesmen': ['salesmendeliveryratesufficientcountavailableornot', 'salesmendelivery', 'salesmen'],
  'infra:delivery': ['deliveryunitsrateitisasperrequirementavailableornot', 'deliveryunits'],
  'infra:godown': ['godownwithrequiredspace', 'godown'],
  'infra:computer': ['computercomputeroperatoravailability', 'computeroperatoravailability', 'computeravailability'],
  'infra:reputation': ['reputationinthemarketplace', 'reputation'],
  'infra:coverage': ['coverageofoutletsonaregularbasis', 'outletcoverage'],
  'infra:credit': ['extendingcredittothemarket', 'extendingcredit'],
  'infra:involvement': ['degreeofpersonalinvolvementwithbusiness', 'personalinvolvement'],
}

// Exact synonym match only — no substring fuzz. Used for header-row detection, where a data
// VALUE cell (e.g. a "New DB" answer sitting next to a "New DB / Replacement / Additional" label)
// can otherwise fuzzy-match a completely different field (dbCategory's "newdbtype" synonym
// contains "newdb") and falsely look like a second header column.
function fieldForExact(rawKey: string): Field | null {
  const k = norm(rawKey)
  if (!k) return null
  for (const field of Object.keys(SYN) as Field[]) if (SYN[field].includes(k)) return field
  return null
}

function fieldFor(rawKey: string): Field | null {
  const k = fieldForExact(rawKey)
  if (k) return k
  const normKey = norm(rawKey)
  // Fuzzy fallback for label cells only — require BOTH sides to be a real word (not a short
  // value like "Y" or "8" that happens to share a letter run with some synonym) before doing a
  // substring match.
  if (normKey.length < 4) return null
  for (const field of Object.keys(SYN) as Field[]) {
    for (const s of SYN[field]) if (s.length >= 4 && (normKey.includes(s) || s.includes(normKey))) return field
  }
  return null
}

function cleanNumber(v: string): string {
  const m = String(v).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)
  return m ? m[1] : ''
}

// Excel percentage cells read back as a fraction (0.205, not "20.5%") — scale up only when the
// value actually looks like a fraction, so a sheet that already states "20.5" isn't doubled down.
function cleanPercent(v: string): string {
  const n = parseFloat(cleanNumber(v))
  if (!Number.isFinite(n)) return ''
  return String(n > 0 && n <= 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10)
}

function matchDbCategory(v: string): DbCategory | undefined {
  const k = norm(v)
  if (!k) return undefined
  const exact = DB_TYPES.find((t) => norm(t) === k || k.includes(norm(t)) || norm(t).includes(k))
  if (exact) return exact
  if (k.includes('gt')) return 'GT DB (with CSO/DSM)'
  if (k.includes('gm')) return 'GM Excl DB'
  if (k.includes('trad')) return 'Traders'
  return undefined
}

function matchSubtype(v: string): ParsedLead['dbSubtype'] {
  const k = norm(v)
  if (!k) return undefined
  if (k.includes('replace')) return 'Replacement DB'
  if (k.includes('addition')) return 'Additional DB'
  if (k.includes('new')) return 'New DB'
  return undefined
}

const TRUTHY = /^(y|yes|true|done|filled|complete)/i

// Map a raw {field → string} bag into a cleaned, typed ParsedLead.
function finalize(raw: Partial<Record<Field, string>>): ParsedLead {
  const out: ParsedLead = {}
  const plain: PlainField[] = [
    'smName', 'asmName', 'aseName', 'firmName', 'contactPerson', 'phone', 'email', 'town', 'state',
    'oldDbCode', 'additionalReason', 'gst', 'companiesHandled', 'agencySince',
  ]
  for (const f of plain) if (raw[f]) out[f] = raw[f]
  if (raw.turnover) out.turnover = cleanNumber(raw.turnover)
  if (raw.expectedRcplTurnover) out.expectedRcplTurnover = cleanNumber(raw.expectedRcplTurnover)
  if (raw.workingCapital) out.workingCapital = cleanNumber(raw.workingCapital)
  if (raw.overallCoverage) out.overallCoverage = cleanNumber(raw.overallCoverage)
  if (raw.rcplPlannedCoverage) out.rcplPlannedCoverage = cleanNumber(raw.rcplPlannedCoverage)
  if (raw.ownFunds) out.ownFunds = cleanNumber(raw.ownFunds)
  if (raw.ccLimit) out.ccLimit = cleanNumber(raw.ccLimit)
  if (raw.rcplContributionPct) out.rcplContributionPct = cleanPercent(raw.rcplContributionPct)
  if (raw.wsContributionPct) out.wsContributionPct = cleanPercent(raw.wsContributionPct)
  if (raw.gst) out.gst = raw.gst.toUpperCase()
  if (raw.dbCategory) { const c = matchDbCategory(raw.dbCategory); if (c) out.dbCategory = c }
  if (raw.dbSubtype) { const s = matchSubtype(raw.dbSubtype); if (s) out.dbSubtype = s }
  if (raw.disengagementFilled) out.disengagementFilled = TRUTHY.test(raw.disengagementFilled.trim())
  const infra: Partial<InfraState> = {}
  for (const key of [...SCORED_INFRA_KEYS, 'reputation'] as (keyof InfraState)[]) {
    const v = raw[`infra:${key}` as Field]
    if (v) { const n = parseFloat(cleanNumber(v)); if (Number.isFinite(n)) infra[key] = n }
  }
  if (Object.keys(infra).length) out.infra = infra
  const blob = norm(Object.values(raw).join(' ') + ' ' + (raw.partnerType ?? ''))
  if (/vendor|packaging|supplier|copacker|posm/.test(blob)) out.partnerType = 'vendor'
  return out
}

function pickSheet(wb: XLSX.WorkBook): XLSX.WorkSheet | undefined {
  const realName = wb.SheetNames.find((n) => RECOMMENDATION_SHEET.test(n))
  const name = realName ?? wb.SheetNames[0]
  return name ? wb.Sheets[name] : undefined
}

// Parse EVERY lead in the sheet: one per data row (header-row layout) or one total (key/value —
// the real workbook's own layout, label anywhere in the row, value in the next non-blank cell).
export async function parseLeadExcelAll(file: File): Promise<ParsedLead[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = pickSheet(wb)
  if (!sheet) throw new Error('That file has no readable sheet.')
  const grid = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, blankrows: false, defval: '' })
  const leads: ParsedLead[] = []

  // A true header row has 2+ DISTINCT recognizable field names in it. Uses the strict exact-only
  // matcher — the fuzzy one lets a data VALUE cell fuzzy-match an unrelated field (e.g. a "New DB"
  // answer next to the real workbook's "New DB / Replacement / Additional" label also fuzzy-hits
  // dbCategory's "newdbtype" synonym), which would make an ordinary key/value row look like it
  // has 2 header columns and wrongly derail the whole parse into header-row mode.
  const headerIdx = grid.findIndex((r) => new Set(r.map((c) => fieldForExact(String(c))).filter(Boolean)).size >= 2)
  if (headerIdx >= 0) {
    const headers = grid[headerIdx].map((c) => fieldFor(String(c)))
    for (let r = headerIdx + 1; r < grid.length; r++) {
      const row = grid[r]
      if (!row || !row.some((c) => String(c).trim())) continue
      const raw: Partial<Record<Field, string>> = {}
      headers.forEach((field, ci) => { if (field) { const t = String(row[ci] ?? '').trim(); if (t && !raw[field]) raw[field] = t } })
      const lead = finalize(raw)
      if (Object.keys(lead).length) leads.push(lead)
    }
  } else {
    // Key/value: scan every cell in the row for a recognized label, then take the first non-blank
    // cell after it as the value — the real workbook's labels sit in column B (not A), with up to
    // two more comparison-DB columns after the value that stay blank for the actual pick.
    const raw: Partial<Record<Field, string>> = {}
    for (const row of grid) {
      if (!row || row.length < 2) continue
      for (let i = 0; i < row.length - 1; i++) {
        const field = fieldFor(String(row[i]))
        if (!field) continue
        const t = String(row.slice(i + 1).find((c) => String(c).trim()) ?? '').trim()
        if (t && !raw[field]) raw[field] = t
        break
      }
    }
    const lead = finalize(raw)
    if (Object.keys(lead).length) leads.push(lead)
  }
  return leads
}

// Convenience: just the first lead (kept for any single-lead caller).
export async function parseLeadExcel(file: File): Promise<ParsedLead> {
  return (await parseLeadExcelAll(file))[0] ?? {}
}

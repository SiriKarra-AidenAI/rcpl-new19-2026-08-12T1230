import './IntakeInbox.css'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Modal, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import type { IconName } from '../components/ui/icons'
import { useApp } from '../store'
import { EXTRACTIONS, REQUIRED_DOCS, capturedCount, missingFieldLabels, downloadRealTemplate, displayNameOfExtraction, firmOfExtraction } from '../mock/intake'
import type { Extraction, ExtractedField, IntakeChannel, IntakePriority, RequiredDoc } from '../mock/intake'
import { extractEmail } from '../lib/extract'
import { parseLeadExcelAll } from '../lib/excelLead'
import type { ParsedLead } from '../lib/excelLead'
import { ScoutingPanel } from './Scouting'
import { DB_TYPES, INFRA_FACTORS } from '../mock/onboarding'
import type { DbCategory } from '../mock/onboarding'
import { DEMO_USERS, ROLE_BY_CODE } from '../mock/roles'
import { applyPartnerToDiscForm, BLANK_DISC_FORM, DB_SUBTYPES, DisengagementFormFields, SUBTYPE_MAP } from '../components/DisengagementForm'
import type { DisengagementForm } from '../types'

const VENDOR_DOCS = ['GST', 'PAN', 'ISO 9001', 'Factory Audit Report']

const BLANK_CREATE_FORM = {
  partnerType: 'distributor' as 'distributor' | 'vendor',
  firmName: '', contactPerson: '', phone: '', email: '', town: '', state: 'Maharashtra',
  dbSubtype: 'New DB' as typeof DB_SUBTYPES[number], dbCategory: 'GT DB (with CSO/DSM)' as DbCategory,
  turnover: '', gst: '', oldDbCode: '', oldDbName: '', additionalReason: '',
}

const priorityPill = (p?: IntakePriority) =>
  p === 'high' ? <Pill tone="crit" dot>High priority</Pill>
    : p === 'low' ? <Pill tone="neutral">Low priority</Pill>
      : null

const initialsOf = (s: string) => s.replace(/[^a-zA-Z0-9 ]/g, '').split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

export function IntakeInbox() {
  const navigate = useNavigate()
  const location = useLocation()
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const [tab, setTab] = useState<IntakeChannel>('email')
  const [scoutMode, setScoutMode] = useState(false)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [noMatchAgency, setNoMatchAgency] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pf, setPf] = useState({ from: '', subject: '', body: '' })
  const [busy, setBusy] = useState(false)
  const [inbox, setInbox] = useState<{ connected: boolean; configured?: boolean; address?: string; error?: string }>({ connected: false })
  const [, setTick] = useState(0)
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})
  // A structured "fill it in yourself" alternative to Paste Email — same required-fields +
  // documents checklist an incoming enquiry would have, for when there's no email to extract from.
  const [createOpen, setCreateOpen] = useState(false)
  const [cf, setCf] = useState(BLANK_CREATE_FORM)
  const [cfDocs, setCfDocs] = useState<Record<string, File | null>>({})
  // The Disengagement Form ("next sheet") for a Replacement DB — filled in right here, inline,
  // at Create Lead time when possible, matching the workbook's own instruction, so the
  // Discontinuation Form gate in Approvals is already cleared by the time the case is raised.
  const [cfDiscForm, setCfDiscForm] = useState<DisengagementForm>(BLANK_DISC_FORM)
  // Create-a-lead has two tabs: type it in (manual) or upload a filled Excel/CSV that auto-fills it.
  const [createTab, setCreateTab] = useState<'manual' | 'excel'>('manual')
  const [excelNote, setExcelNote] = useState<string | null>(null)
  const [excelErr, setExcelErr] = useState<string | null>(null)
  const [rowMenu, setRowMenu] = useState<string | null>(null)

  // Distributors that actually have a DB Code on file — the only real source for "OLD DB
  // Code" (see the Replacement DB picker below); there's nowhere else in the app to look one up.
  const allPartners = useApp((s) => s.partners)
  const codedDistributors = allPartners.filter((p) => p.partnerType === 'distributor' && p.dbCode)

  // Items already reviewed & converted to a lead are consumed — they leave the inbox.
  // Besides the explicit processed list, also drop any item whose firm already exists as a
  // created lead (covers leads created before processed-tracking existed).
  const processedIntakeIds = useApp((s) => s.processedIntakeIds)
  const candidates = useApp((s) => s.candidates)
  const logAudit = useApp((s) => s.logAudit)
  const scoutingCases = useApp((s) => s.scoutingCases)
  // A newly created intake row (Excel import, manual Create Lead, or pasted/uploaded text) has
  // no seed entry in EXTRACTIONS — persisting it here is what makes it survive a page reload
  // instead of vanishing the moment the module re-initializes (see store.ts's manualExtractions).
  const addManualExtraction = useApp((s) => s.addManualExtraction)
  const removeManualExtraction = useApp((s) => s.removeManualExtraction)
  // Explicitly deleted items — a SEEDED item (part of EXTRACTIONS' base object literal) has no
  // manualExtractions entry to remove, so without this tombstone list it reappears the moment
  // EXTRACTIONS resets to its seed on the next reload.
  const deletedIntakeIds = useApp((s) => s.deletedIntakeIds)
  const markIntakeDeleted = useApp((s) => s.markIntakeDeleted)
  const createdLeadNames = new Set(candidates.filter((c) => c.userCreated).map((c) => c.name.toLowerCase()))
  const firmOf = firmOfExtraction
  const all = Object.values(EXTRACTIONS).filter(
    (e) => !processedIntakeIds.includes(e.id) && !createdLeadNames.has(firmOf(e)) && !deletedIntakeIds.includes(e.id))
  const emails = all.filter((e) => e.channel === 'email')
  const docs = all.filter((e) => e.channel === 'document')
  const q = query.trim().toLowerCase()
  const match = (e: Extraction) => q === '' || e.source.toLowerCase().includes(q) || e.title.toLowerCase().includes(q)
  // Newest first: mock items sort by their absolute timestamp; freshly ingested ones carry
  // Date.now() in their id (far larger than any mock date), so they always land on top. Matches
  // the LEADING digits only (not `$`-anchored) — an Excel bulk import's ids carry an extra
  // `-${idx}` suffix (`intake-${Date.now()}-0`, `-1`, …), which an end-anchored regex never
  // matched, silently falling through to Date.parse(undefined) = 0 and sinking to the bottom.
  const recency = (e: Extraction): number => {
    const m = e.id.match(/^intake-(\d+)/)
    if (m) return +m[1]
    const t = Date.parse(e.receivedFull ?? '')
    return Number.isNaN(t) ? 0 : t
  }
  const rows = (tab === 'email' ? emails : docs).filter(match).sort((a, b) => recency(b) - recency(a))

  // Open the full review as an in-app detail view (same window — keeps the sidebar/topbar).
  const review = (id: string) => navigate(`/intake/${id}`)

  // Summary stats derive from the live intake set, so the counts stay honest as it grows.
  const successfullyExtracted = all.filter((e) => e.candidates || ((e.confidencePct ?? 0) >= 85 && missingFieldLabels(e).length === 0)).length
  const needReview = all.filter((e) => !e.candidates && (missingFieldLabels(e).length > 0 || (e.confidencePct ?? 0) < 85)).length
  const duplicates = all.filter((e) => e.duplicate).length
  const STATS: { label: string; value: string; sub: string; icon: IconName; tone: string }[] = [
    { label: 'Total Received', value: String(all.length), sub: 'Across all channels', icon: 'mail', tone: 'ai' },
    { label: 'Successfully Extracted', value: String(successfullyExtracted), sub: 'High confidence', icon: 'approvals', tone: 'good' },
    { label: 'Need Review', value: String(needReview), sub: 'Missing or low-confidence', icon: 'flag', tone: 'warn' },
    { label: 'Possible Duplicates', value: String(duplicates), sub: 'Flagged by agent', icon: 'templates', tone: 'warn' },
    { label: 'Manual Uploads', value: String(docs.length), sub: 'This week', icon: 'documents', tone: 'ai' },
  ]

  // Parse with the LLM-backed extractor when the local /api/extract server is running;
  // otherwise fall back to the built-in regex extractor. Same ExtractResult shape either way.
  const ingest = async (source: string, subject: string, body: string, channel: IntakeChannel) => {
    setBusy(true)
    let ex: ReturnType<typeof extractEmail>
    let via = 'the built-in extractor'
    try {
      const res = await fetch('/api/extract', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, subject, body }),
      })
      if (!res.ok) throw new Error(String(res.status))
      ex = await res.json()
      via = 'the AI extractor'
    } catch {
      ex = extractEmail({ source, title: subject, body })
    }
    const id = `intake-${Date.now()}`
    const docNames = ex.partnerType === 'vendor' ? VENDOR_DOCS : REQUIRED_DOCS
    const newExt: Extraction = {
      id, channel,
      source: source || (channel === 'email' ? 'pasted@intake' : 'manual-upload'),
      title: subject || '(no subject)', receivedAt: 'just now',
      confidencePct: ex.confidencePct, fields: ex.fields, summary: ex.summary,
      partnerType: ex.partnerType, priority: ex.priority, region: ex.region,
      assignedTo: 'Unassigned', raw: body,
      documents: docNames.map((name) => ({ name, received: false })),
    }
    EXTRACTIONS[id] = newExt
    addManualExtraction(newExt)
    setBusy(false)
    setTab(channel)
    setHighlightId(id)
    setNote(`Parsed with ${via} — extracted ${ex.captured}/9 fields; review and create a lead.`)
    window.setTimeout(() => rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
    window.setTimeout(() => setHighlightId(null), 3000)
  }

  const cfDocNames = cf.partnerType === 'vendor' ? VENDOR_DOCS : REQUIRED_DOCS
  // Builds the same Extraction shape ingest() does, straight from the form — no extractor pass
  // needed since every field is already structured — then hands off to the normal Intake Review
  // screen (documents, Document Intelligence, notes) instead of duplicating that flow here.
  // Deliberately NOT an immediate shortlist: if a required document is still missing, Manual
  // Upload (via Intake Review) is where it actually gets attached before the lead is finalized —
  // skipping straight to Leads would leave nowhere to upload it afterward.
  // Build one intake lead (an Extraction row) from a parsed Excel row — the bulk equivalent of
  // createLeadManually, sourced from the sheet instead of the form and without navigating away.
  const createLeadFromParsed = (lead: ParsedLead, idx: number): string | null => {
    const firmName = (lead.firmName ?? '').trim()
    if (!firmName) return null
    const partnerType = lead.partnerType ?? 'distributor'
    const dbSubtype = lead.dbSubtype ?? 'New DB'
    const subtype = SUBTYPE_MAP[dbSubtype]
    const town = (lead.town ?? '').trim()
    const state = (lead.state ?? 'Maharashtra').trim()
    const dbCategory = lead.dbCategory ?? DB_TYPES[0]
    const docNames = partnerType === 'vendor' ? VENDOR_DOCS : REQUIRED_DOCS
    const fields: ExtractedField[] = [
      // Basic Information block, verbatim off the real workbook — who in the field scouted/
      // recommended this DB, not who happened to upload the sheet.
      { label: 'SM Name', value: (lead.smName ?? '').trim() || 'Not provided', ok: !!lead.smName },
      { label: 'ASM Name', value: (lead.asmName ?? '').trim() || 'Not provided', ok: !!lead.asmName },
      { label: 'ASE Name', value: (lead.aseName ?? '').trim() || 'Not provided', ok: !!lead.aseName },
      { label: 'Firm / Agency Name', value: firmName, ok: true },
      { label: 'Contact Person', value: (lead.contactPerson ?? '').trim(), ok: !!lead.contactPerson },
      { label: 'Phone Number', value: (lead.phone ?? '').trim(), ok: !!lead.phone },
      { label: 'Email Address', value: (lead.email ?? '').trim(), ok: !!lead.email },
      { label: 'Town / City', value: town, ok: !!town },
      { label: 'State', value: state, ok: !!state },
      { label: 'DB Type Requested', ...(partnerType === 'distributor' ? { value: dbCategory, ok: true } : { value: 'Not applicable (Vendor)', ok: false }) },
      ...(partnerType === 'distributor' ? [{ label: 'New DB / Replacement / Additional', value: dbSubtype, ok: true }] : []),
      ...(subtype === 'replacement' ? [{ label: 'OLD DB Code', value: (lead.oldDbCode ?? '').trim() || 'Not provided', ok: !!lead.oldDbCode }] : []),
      ...(subtype === 'additional' ? [{ label: 'Reason for Additional DB', value: (lead.additionalReason ?? '').trim() || 'Not provided', ok: !!lead.additionalReason }] : []),
      { label: 'Turnover Claim (₹/mo)', value: lead.turnover ? `₹${lead.turnover}L` : '', ok: !!lead.turnover },
      { label: 'Working Capital Required (₹L)', value: lead.workingCapital ? `₹${lead.workingCapital}L` : 'Not provided', ok: !!lead.workingCapital },
      { label: 'GST Number', value: (lead.gst ?? '').trim() || 'Not provided', ok: !!lead.gst },
      // Background Information / Coverage Data / Infrastructure / Financials — the rest of the
      // real workbook's "Appointment Recommendation Form", when the upload was that real file
      // rather than a plain header-row sheet. createLead() in IntakeReview.tsx reads these same
      // labels back out to build the lead's real infraFactors/ownFunds/ccLimit/coverage instead
      // of a flat default, so filling this form in genuinely feeds the evaluation later on.
      { label: 'Companies Handled', value: (lead.companiesHandled ?? '').trim() || 'Not provided', ok: !!lead.companiesHandled },
      { label: 'Agency Since (years)', value: (lead.agencySince ?? '').trim() || 'Not provided', ok: !!lead.agencySince },
      { label: 'Expected RCPL Turnover (₹L/mo)', value: lead.expectedRcplTurnover ? `₹${lead.expectedRcplTurnover}L` : 'Not provided', ok: !!lead.expectedRcplTurnover },
      { label: 'RCPL Contribution to Overall Business (%)', value: lead.rcplContributionPct ? `${lead.rcplContributionPct}%` : 'Not provided', ok: !!lead.rcplContributionPct },
      { label: "Overall Firm's Coverage (OL)", value: lead.overallCoverage ?? 'Not provided', ok: !!lead.overallCoverage },
      { label: 'WS Contribution to His Business (%)', value: lead.wsContributionPct ? `${lead.wsContributionPct}%` : 'Not provided', ok: !!lead.wsContributionPct },
      { label: 'RCPL Planned Coverage (OL)', value: lead.rcplPlannedCoverage ?? 'Not provided', ok: !!lead.rcplPlannedCoverage },
      // "Reputation in the marketplace" is a section-divider label in the real workbook, not a
      // rated field with its own input cell — showing it here as "Not provided" reads as a
      // capture failure when there's structurally nothing to capture. Excluded, same as
      // SCORED_INFRA_KEYS already excludes it from the average.
      ...INFRA_FACTORS.filter((f) => f.scored !== false).map((f) => {
        const v = lead.infra?.[f.key]
        return { label: `Infra — ${f.label}`, value: v != null ? `${v}/10` : 'Not provided', ok: v != null }
      }),
      { label: 'Total Own Funds/Borrowed (₹L)', value: lead.ownFunds ? `₹${lead.ownFunds}L` : 'Not provided', ok: !!lead.ownFunds },
      { label: 'CC Limit (₹L)', value: lead.ccLimit ? `₹${lead.ccLimit}L` : 'Not provided', ok: !!lead.ccLimit },
      ...(subtype === 'replacement'
        ? [{ label: 'Disengagement Form Filled', value: lead.disengagementFilled ? 'Yes' : 'Not provided', ok: !!lead.disengagementFilled }]
        : []),
    ]
    const documents: RequiredDoc[] = docNames.map((name) => ({ name, received: false }))
    const captured = fields.filter((f) => f.ok).length
    const id = `intake-${Date.now()}-${idx}`
    const newExt: Extraction = {
      id, channel: 'document', source: (lead.email ?? '').trim() || 'excel-upload',
      title: `Excel-imported lead — ${firmName}`, receivedAt: 'just now',
      confidencePct: Math.round((captured / fields.length) * 100),
      fields, partnerType, priority: 'normal',
      region: town ? `${town}, ${state}` : undefined,
      assignedTo: `${DEMO_USERS[viewingAs].name} (${ROLE_BY_CODE[viewingAs].label})`,
      attachments: [],
      summary: `${firmName} (${town || 'town not entered'}) — imported from Excel by ${DEMO_USERS[viewingAs].name}. ${captured}/${fields.length} fields captured, 0/${documents.length} documents attached.`,
      documents,
      subtype: partnerType === 'distributor' ? subtype : undefined,
      oldDbCode: subtype === 'replacement' ? (lead.oldDbCode ?? '').trim() || undefined : undefined,
      additionalReason: subtype === 'additional' ? (lead.additionalReason ?? '').trim() || undefined : undefined,
    }
    EXTRACTIONS[id] = newExt
    addManualExtraction(newExt)
    return id
  }

  // Remove an intake item from the inbox — permanently, including a reload. EXTRACTIONS itself
  // resets to its base seed on every reload, so deleting a SEEDED item (or a runtime-created one
  // already mirrored into manualExtractions) both need the persisted tombstone below, not just
  // the in-memory delete, or it reappears the next time the module re-initializes.
  const deleteIntake = (id: string) => {
    const firm = firmOfExtraction(EXTRACTIONS[id]) || 'lead'
    delete EXTRACTIONS[id]
    removeManualExtraction(id)
    markIntakeDeleted(id)
    logAudit({ actor: DEMO_USERS[viewingAs].name, kind: 'human', action: `Deleted intake item "${firm}"`, entity: 'Intake Inbox' })
    setRowMenu(null)
    setHighlightId(null)
    setNote(`Deleted "${firm}" from the inbox.`)
  }

  const onExcelFile = async (file: File) => {
    setExcelErr(null); setExcelNote(null)
    try {
      const leads = await parseLeadExcelAll(file)
      const usable = leads.filter((l) => (l.firmName ?? '').trim())
      if (!usable.length) { setExcelErr("Couldn't find any leads with a Firm/Agency name — check the column headers against the list above."); return }
      const ids = usable.map((l, i) => createLeadFromParsed(l, i)).filter(Boolean) as string[]
      resetCreate()               // close the modal + clear form state
      setTab('document')          // land on the Manual-uploads tab where the new leads appear
      setHighlightId(ids[0] ?? null)
      setNote(`Imported ${ids.length} lead${ids.length > 1 ? 's' : ''} from ${file.name} — each is in Manual uploads below, ready to review.`)
      window.setTimeout(() => setHighlightId(null), 3000)
    } catch (err) {
      setExcelErr(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }
  const resetCreate = () => {
    setCreateOpen(false); setCf(BLANK_CREATE_FORM); setCfDocs({}); setCfDiscForm(BLANK_DISC_FORM)
    setCreateTab('manual'); setExcelNote(null); setExcelErr(null)
  }

  const createLeadManually = () => {
    const subtype = SUBTYPE_MAP[cf.dbSubtype]
    // Only counts as "filled" once the two fields the sheet itself requires are actually
    // entered — an all-blank form object shouldn't silently satisfy the Discontinuation Form gate.
    const discFormFilled = subtype === 'replacement' && cfDiscForm.distributorNameAddressDbCode.trim() && cfDiscForm.dateOfAppointment.trim()
    const fields: ExtractedField[] = [
      { label: 'Firm / Agency Name', value: cf.firmName.trim(), ok: !!cf.firmName.trim() },
      { label: 'Contact Person', value: cf.contactPerson.trim(), ok: !!cf.contactPerson.trim() },
      { label: 'Phone Number', value: cf.phone.trim(), ok: !!cf.phone.trim() },
      { label: 'Email Address', value: cf.email.trim(), ok: !!cf.email.trim() },
      { label: 'Town / City', value: cf.town.trim(), ok: !!cf.town.trim() },
      { label: 'State', value: cf.state.trim(), ok: !!cf.state.trim() },
      { label: 'DB Type Requested', ...(cf.partnerType === 'distributor'
        ? { value: cf.dbCategory, ok: true }
        : { value: 'Not applicable (Vendor)', ok: false }) },
      ...(cf.partnerType === 'distributor' ? [{ label: 'New DB / Replacement / Additional', value: cf.dbSubtype, ok: true }] : []),
      ...(subtype === 'replacement' ? [{ label: 'OLD DB Code', value: cf.oldDbCode.trim() ? `${cf.oldDbCode.trim()}${cf.oldDbName.trim() ? ` — ${cf.oldDbName.trim()}` : ''}` : 'Not provided', ok: !!cf.oldDbCode.trim() }] : []),
      ...(subtype === 'additional' ? [{ label: 'Reason for Additional DB', value: cf.additionalReason.trim() || 'Not provided', ok: !!cf.additionalReason.trim() }] : []),
      { label: 'Turnover Claim (₹/mo)', value: cf.turnover.trim() ? `₹${cf.turnover.trim()}L` : '', ok: !!cf.turnover.trim() },
      { label: 'GST Number', value: cf.gst.trim() || 'Not provided', ok: !!cf.gst.trim() },
    ]
    const documents: RequiredDoc[] = cfDocNames.map((name) => {
      const file = cfDocs[name]
      return file ? { name, received: true, file: file.name } : { name, received: false }
    })
    const captured = fields.filter((f) => f.ok).length
    const id = `intake-${Date.now()}`
    const newExt: Extraction = {
      id, channel: 'document',
      source: cf.email.trim() || 'manual-entry',
      title: `Manually created lead — ${cf.firmName.trim() || 'untitled'}`,
      receivedAt: 'just now', confidencePct: Math.round((captured / fields.length) * 100),
      fields, partnerType: cf.partnerType, priority: 'normal',
      region: cf.town.trim() ? `${cf.town.trim()}, ${cf.state.trim()}` : undefined,
      assignedTo: `${DEMO_USERS[viewingAs].name} (${ROLE_BY_CODE[viewingAs].label})`,
      attachments: Object.values(cfDocs).filter((f): f is File => !!f).map((f) => f.name),
      summary: `${cf.firmName.trim() || 'This firm'} (${cf.town.trim() || 'town not entered'}) — entered directly by ${DEMO_USERS[viewingAs].name}, no incoming email. ${documents.filter((d) => d.received).length}/${documents.length} documents attached.`,
      documents,
      subtype: cf.partnerType === 'distributor' ? subtype : undefined,
      oldDbCode: subtype === 'replacement' ? cf.oldDbCode.trim() || undefined : undefined,
      oldDbName: subtype === 'replacement' ? cf.oldDbName.trim() || undefined : undefined,
      additionalReason: subtype === 'additional' ? cf.additionalReason.trim() || undefined : undefined,
      discontinuationForm: discFormFilled ? cfDiscForm : undefined,
    }
    EXTRACTIONS[id] = newExt
    addManualExtraction(newExt)
    setCreateOpen(false)
    setCf(BLANK_CREATE_FORM)
    setCfDocs({})
    setCfDiscForm(BLANK_DISC_FORM)
    navigate(`/intake/${id}`)
  }

  // Dashboard's "Create Lead" shortcut lands here with this flag so the form opens immediately
  // instead of just dropping the ASE/ASM on the inbox list.
  useEffect(() => {
    if ((location.state as { openCreateLead?: boolean } | null)?.openCreateLead) {
      setCreateOpen(true)
      navigate(location.pathname, { replace: true, state: null })
    }
    // Arriving from "Serve termination notice" → open the Scouting tab on the new case.
    if ((location.state as { scouting?: boolean } | null)?.scouting) {
      setScoutMode(true)
      navigate(location.pathname, { replace: true, state: null })
    }
    // Closing out of Intake Review lands back here with which channel it opened from, so
    // closing a Manual Upload item doesn't dump you back on the Email tab (tab is local state —
    // it doesn't survive the navigate away and back on its own).
    const returnTab = (location.state as { returnTab?: IntakeChannel } | null)?.returnTab
    if (returnTab) {
      setTab(returnTab)
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const agencies = (location.state as { agencies?: string[] } | null)?.agencies
    if (!agencies || agencies.length === 0) return
    let found: Extraction | undefined
    for (const agency of agencies) {
      const needle = agency.toLowerCase()
      found = all.find((r) => r.source.toLowerCase().includes(needle) || r.title.toLowerCase().includes(needle) || needle.includes(r.title.toLowerCase().split(' ')[0]))
      if (found) break
    }
    if (found) {
      setTab(found.channel)
      setHighlightId(found.id)
      setNoMatchAgency(null)
      window.setTimeout(() => rowRefs.current[found!.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
      window.setTimeout(() => setHighlightId(null), 3000)
    } else {
      setNoMatchAgency(agencies[0])
    }
    navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pull server-extracted intake (the Gmail poller) into the inbox + show connection status.
  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        const r = await fetch('/api/intake')
        if (r.ok) {
          const items: Extraction[] = await r.json()
          let changed = false
          for (const it of items) {
            // Not just "add if missing" — a distributor's reply merges into the SAME item id
            // server-side (see backend/intake_routes.py's _merge_reply), so an already-known id can come
            // back with previously-missing fields now filled in and needs to actually refresh.
            const existing = EXTRACTIONS[it.id]
            if (!existing || JSON.stringify(existing) !== JSON.stringify(it)) { EXTRACTIONS[it.id] = it; changed = true }
          }
          if (changed && alive) setTick((n) => n + 1)
        }
      } catch { /* server not running — keep the mock data */ }
      try {
        const s = await fetch('/api/inbox/status')
        if (s.ok && alive) setInbox(await s.json())
      } catch { /* ignore */ }
    }
    pull()
    // Matches the backend's own IMAP poll cadence (INTAKE_POLL_SECONDS, default 10s) so a
    // freshly-captured email shows up here without an extra ~20s on top of that wait.
    const t = window.setInterval(pull, 8000)
    return () => { alive = false; window.clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rowStyle = (id: string) =>
    highlightId === id ? { background: 'var(--ai-bg)', outline: '2px solid var(--ai-text)', outlineOffset: '-2px', transition: 'background 0.3s' } : undefined
  const confTone = (p: number) => (p >= 85 ? 'good' : p >= 60 ? 'warn' : 'crit') as 'good' | 'warn' | 'crit'

  return (
    <div>
      <div className="page-head">
        <div className="row-between">
          <div>
            <h1>Intake Inbox <span className="page-info-ic" title="Candidates arrive via email or manual upload. The Intake Agent reads each, extracts the data, and drafts a candidate profile — you review and confirm, you don't retype."><Icon name="help" size={13} /></span></h1>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {viewingAs === 'ase_asm' && (
              <Button variant="ghost" size="sm" onClick={() => navigate('/my-settings')}><Icon name="settings" size={13} /> Inbox Settings</Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setPasteOpen(true)}><Icon name="mail" size={14} /> Paste email</Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Icon name="new" size={14} /> Create Lead</Button>
            {viewingAs !== 'ase_asm' && (
              <Button onClick={() => navigate('/new-application')}><Icon name="new" size={14} /> New Application</Button>
            )}
          </div>
        </div>
      </div>

      <div className="pt-summary cols-5">
        {STATS.map((s) => (
          <div className="pt-stat" key={s.label}>
            <span className={`pt-stat-ic pt-tone-${s.tone}`}><Icon name={s.icon} size={17} /></span>
            <div className="pt-stat-label">{s.label}</div>
            <div className="pt-stat-value">{s.value}</div>
            <div className="pt-stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {inbox.configured && inbox.error ? (
        <div className="notify-bar" style={{ marginBottom: '1rem' }}>
          <Icon name="flag" size={14} /> Inbox configured but couldn't connect — check GMAIL_USER / GMAIL_APP_PASSWORD and that IMAP is enabled.
          <span className="muted-note" style={{ marginLeft: '0.4rem' }}>{inbox.error}</span>
        </div>
      ) : null}

      {noMatchAgency && (
        <div className="notify-bar" style={{ marginBottom: '1rem' }}>
          <Icon name="new" size={14} /> No intake item found yet for <strong>{noMatchAgency}</strong> — start a manual application from New Application, or wait for them to reach out.
        </div>
      )}
      {note && <div className="notify-bar" style={{ marginBottom: '1rem' }}><Icon name="new" size={14} /> {note}</div>}

      <div className="pt-toolbar">
        <div className="tabs">
          <button className={`tab ${tab === 'email' && !scoutMode ? 'active' : ''}`} onClick={() => { setScoutMode(false); setTab('email') }}>Email <span style={{ opacity: 0.6 }}>· {emails.length}</span></button>
          <button className={`tab ${tab === 'document' && !scoutMode ? 'active' : ''}`} onClick={() => { setScoutMode(false); setTab('document') }}>Manual Upload <span style={{ opacity: 0.6 }}>· {docs.length}</span></button>
          <button className={`tab ${scoutMode ? 'active' : ''}`} onClick={() => setScoutMode(true)}>Scouting <span style={{ opacity: 0.6 }}>· {scoutingCases.length}</span></button>
        </div>
        <div className="pt-toolbar-actions">
          {!scoutMode && <span className="pt-search"><Icon name="search" size={14} /><input placeholder="Search by email, subject, or lead…" value={query} onChange={(e) => setQuery(e.target.value)} /></span>}
          {!scoutMode && tab === 'document' && (
            <>
              <Button variant="ghost" size="sm" onClick={downloadRealTemplate}><Icon name="documents" size={13} /> Download template</Button>
              <Button variant="ghost" size="sm" onClick={() => { setCreateOpen(true); setCreateTab('excel') }}><Icon name="new" size={13} /> Upload</Button>
            </>
          )}
        </div>
      </div>

      {scoutMode ? <ScoutingPanel /> : (<>
      <div className="dtable-wrap">
        <table className="dtable">
          <thead><tr><th>From</th><th>Subject</th><th>Extraction Status</th><th>Extracted Fields</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: '1.4rem 0' }}>No intake items match your search.</td></tr>
            )}
            {rows.map((e) => {
              const captured = capturedCount(e)
              const missing = missingFieldLabels(e)
              const fieldNames = e.candidates ? [] : e.fields.filter((f) => f.ok).map((f) => f.label)
              return (
                <tr key={e.id} className="clickable" ref={(el) => { rowRefs.current[e.id] = el }} style={rowStyle(e.id)} onClick={() => review(e.id)}>
                  <td>
                    <div className="pt-name-cell">
                      <span className="pt-avatar" style={{ background: 'var(--ai)' }}>{initialsOf(displayNameOfExtraction(e))}</span>
                      <div>
                        {/* Email rows: the sender's address IS the meaningful "from". Manual
                            upload/Excel rows: e.source is just "excel-upload"/"manual-entry"/a
                            fallback string — show the agency/firm name instead. */}
                        <div className="pt-name">{e.channel === 'email' ? e.source : displayNameOfExtraction(e)}</div>
                        <div className="pt-id">
                          {e.receivedAt} · {e.channel === 'email' ? 'Email' : 'Upload'}
                          {e.region ? ` · ${e.region}` : ''}
                          {e.attachments?.length ? ` · ${e.attachments.length} file${e.attachments.length > 1 ? 's' : ''}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ maxWidth: 260 }}>"{e.title}"</td>
                  <td>
                    {e.candidates ? (
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <Pill tone="good" dot>{e.candidates.length} candidates detected</Pill>
                        {e.duplicate && <Pill tone="warn" dot>Possible duplicate</Pill>}
                        {priorityPill(e.priority)}
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <Pill tone={confTone(e.confidencePct ?? 0)} dot>{captured}/{e.fields.length} fields · {e.confidencePct}%</Pill>
                          {e.documents && e.documents.some((d) => !d.received) && (
                            <Pill tone="warn">{e.documents.filter((d) => !d.received).length} doc{e.documents.filter((d) => !d.received).length > 1 ? 's' : ''} missing</Pill>
                          )}
                          {e.duplicate && <Pill tone="warn" dot>Possible duplicate</Pill>}
                          {e.partnerType === 'vendor' && <Pill tone="ai" dot>Vendor</Pill>}
                          {priorityPill(e.priority)}
                        </div>
                        {missing.length > 0 && <div className="muted-note" style={{ marginTop: '0.3rem' }}>Missing: {missing.join(', ')}</div>}
                      </>
                    )}
                  </td>
                  <td style={{ maxWidth: 220 }}>
                    {e.candidates ? <span className="muted-note">{e.candidates.map((c) => c.name).join(', ')}</span> : (
                      <>
                        <span className="ii-fields">{fieldNames.slice(0, 3).join(', ')}{fieldNames.length > 3 ? '…' : ''}</span>
                        <button className="ii-viewall" onClick={(ev) => { ev.stopPropagation(); review(e.id) }}>View all ({captured})</button>
                      </>
                    )}
                  </td>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    <div className="pt-row-actions">
                      <Button variant="ghost" size="sm" onClick={() => review(e.id)}>Review &amp; Create Lead</Button>
                      <div className="pt-menu-wrap">
                        <button className="pt-menu-btn" title="More" aria-label="More"
                          onClick={() => setRowMenu(rowMenu === e.id ? null : e.id)}>···</button>
                        {rowMenu === e.id && (
                          <>
                            <div className="pt-menu-backdrop" onClick={() => setRowMenu(null)} />
                            <div className="pt-menu" role="menu">
                              <button role="menuitem" onClick={() => { review(e.id); setRowMenu(null) }}>
                                <Icon name="approvals" size={13} /> Review &amp; create
                              </button>
                              <button role="menuitem" className="danger" onClick={() => deleteIntake(e.id)}>
                                <Icon name="close" size={13} /> Delete lead
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="pt-foot">
        <span className="pt-foot-count">Showing 1 to {rows.length} of {rows.length} {tab === 'email' ? 'emails' : 'uploads'}</span>
        <div className="pt-pager">
          <button disabled aria-label="Previous">‹</button>
          <button className="on">1</button>
          <button disabled aria-label="Next">›</button>
        </div>
      </div>
      </>)}

      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} size="lg" title="Paste an email to extract">
        <p className="muted-note" style={{ marginBottom: '0.9rem', fontStyle: 'normal' }}>
          Paste a raw enquiry. The Intake Agent extracts the fields and writes a summary from what it finds — no retyping.
        </p>
        <div className="field">
          <label>From</label>
          <input className="input" value={pf.from} placeholder="suvarna.agencies@gmail.com"
            onChange={(e) => setPf((s) => ({ ...s, from: e.target.value }))} />
        </div>
        <div className="field">
          <label>Subject</label>
          <input className="input" value={pf.subject} placeholder="Interested in becoming an RCPL distributor — Nashik"
            onChange={(e) => setPf((s) => ({ ...s, subject: e.target.value }))} />
        </div>
        <div className="field">
          <label>Email body</label>
          <textarea className="input" style={{ minHeight: 150, resize: 'vertical' }} value={pf.body}
            placeholder="Dear RCPL team, We are Suvarna Agencies, an FMCG distributor in Nashik…"
            onChange={(e) => setPf((s) => ({ ...s, body: e.target.value }))} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.4rem' }}>
          <Button variant="ghost" onClick={() => setPasteOpen(false)}>Cancel</Button>
          <Button disabled={busy || !pf.body.trim()}
            onClick={async () => { await ingest(pf.from, pf.subject, pf.body, 'email'); setPasteOpen(false); setPf({ from: '', subject: '', body: '' }) }}>
            {busy ? 'Extracting…' : 'Extract →'}
          </Button>
        </div>
      </Modal>

      <Modal open={createOpen} onClose={resetCreate} size="lg" title="Create a lead">
        <div className="tabs" style={{ marginBottom: '1rem', border: 'none' }}>
          <button className={`tab ${createTab === 'manual' ? 'active' : ''}`} onClick={() => setCreateTab('manual')}>Manual entry</button>
          <button className={`tab ${createTab === 'excel' ? 'active' : ''}`} onClick={() => setCreateTab('excel')}>Upload Excel</button>
        </div>

        {createTab === 'excel' && (
          <div className="cl-excel">
            <p className="muted-note" style={{ fontStyle: 'normal', marginBottom: '0.9rem' }}>
              Upload the filled <strong>New DB Appointment Module — RCPL v1</strong> workbook (its "Appointment Recommendation Form"
              sheet) — every field it carries (SM/ASM/ASE Name, turnover, coverage, infrastructure scores, financials, etc.) is
              read straight into a lead in your Manual-uploads inbox, ready to review. A plain header-row Excel/CSV
              (one row per lead) also works, for a quick bulk import.
            </p>
            <label className="cl-drop">
              <Icon name="upload" size={22} />
              <span className="cl-drop-t">Choose the filled workbook, or an Excel/CSV file</span>
              <span className="cl-drop-s">.xlsb · .xlsx · .xls · .csv</span>
              <input type="file" accept=".xlsx,.xls,.xlsb,.csv" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onExcelFile(f); e.target.value = '' }} />
            </label>
            {excelErr && <div className="login-error" style={{ marginTop: '0.9rem' }}>{excelErr}</div>}
          </div>
        )}

        {createTab === 'manual' && (<>
        {excelNote && (
          <div className="notify-bar" style={{ marginBottom: '0.8rem' }}>
            <Icon name="check" size={14} /> {excelNote}
          </div>
        )}
        <p className="muted-note" style={{ marginBottom: '0.9rem', fontStyle: 'normal' }}>
          Fill in what the enquiry would have — the same fields and required documents as an incoming email — when there's nothing to paste or extract from.
        </p>

        <div className="field">
          <label>Partner Type</label>
          <select className="select" value={cf.partnerType}
            onChange={(e) => setCf((s) => ({ ...s, partnerType: e.target.value as 'distributor' | 'vendor' }))}>
            <option value="distributor">Distributor</option>
            <option value="vendor">Vendor</option>
          </select>
        </div>
        <div className="field">
          <label>Firm / Agency Name *</label>
          <input className="input" value={cf.firmName} placeholder="Suvarna Agencies"
            onChange={(e) => setCf((s) => ({ ...s, firmName: e.target.value }))} />
        </div>
        <div className="field">
          <label>Contact Person</label>
          <input className="input" value={cf.contactPerson} placeholder="Mr. R. Suvarnkar"
            onChange={(e) => setCf((s) => ({ ...s, contactPerson: e.target.value }))} />
        </div>
        <div className="field">
          <label>Phone Number</label>
          <input className="input" value={cf.phone} placeholder="+91 98230 12345"
            onChange={(e) => setCf((s) => ({ ...s, phone: e.target.value }))} />
        </div>
        <div className="field">
          <label>Email Address</label>
          <input className="input" value={cf.email} placeholder="suvarna.agencies@example.com"
            onChange={(e) => setCf((s) => ({ ...s, email: e.target.value }))} />
        </div>
        <div className="field">
          <label>Town / City</label>
          <input className="input" value={cf.town} placeholder="Nashik"
            onChange={(e) => setCf((s) => ({ ...s, town: e.target.value }))} />
        </div>
        <div className="field">
          <label>State</label>
          <input className="input" value={cf.state} onChange={(e) => setCf((s) => ({ ...s, state: e.target.value }))} />
        </div>
        {cf.partnerType === 'distributor' && (
          <>
            <div className="field">
              <label>New DB / Replacement DB / Additional DB</label>
              <select className="select" value={cf.dbSubtype}
                onChange={(e) => setCf((s) => ({ ...s, dbSubtype: e.target.value as typeof DB_SUBTYPES[number] }))}>
                {DB_SUBTYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            {cf.dbSubtype === 'Additional DB' && (
              <div className="field">
                <label>If Additional DB, mention reason</label>
                <input className="input" value={cf.additionalReason} placeholder="New beat — GM Excl DB"
                  onChange={(e) => setCf((s) => ({ ...s, additionalReason: e.target.value }))} />
              </div>
            )}
            {cf.dbSubtype === 'Replacement DB' && (
              <>
                <div className="field">
                  <label>If Replacement, mention OLD DB Code</label>
                  <select className="select" value={cf.oldDbCode}
                    onChange={(e) => {
                      const code = e.target.value
                      const picked = codedDistributors.find((p) => p.dbCode === code)
                      // A code alone means nothing to a reviewer — carry the name alongside it.
                      setCf((s) => ({ ...s, oldDbCode: code, oldDbName: picked?.legalName ?? '' }))
                      // Pre-fills everything the Partners directory already knows about this DB
                      // (name/address/code, date of appointment, towns covered) so it isn't
                      // re-typed — the picker above is the only real source for this.
                      if (picked) setCfDiscForm((s) => applyPartnerToDiscForm(s, picked))
                    }}>
                    <option value="">Select the DB being replaced…</option>
                    {codedDistributors.map((p) => (
                      <option key={p.id} value={p.dbCode}>{p.dbCode} — {p.legalName} ({p.town})</option>
                    ))}
                  </select>
                  {cf.oldDbName && (
                    <p className="muted-note" style={{ margin: '0.4rem 0 0' }}><Icon name="check" size={12} /> Replacing <strong>{cf.oldDbName}</strong> ({cf.oldDbCode}).</p>
                  )}
                  <p className="muted-note" style={{ margin: '0.4rem 0 0' }}>
                    Pulled from the Partners directory — the DB Code isn't something you look up elsewhere, it's assigned when a distributor is first onboarded.
                  </p>
                </div>
                <div className="field">
                  <label>If Replacement, fill up next sheet — Distributor Disengagement Recommendation Form</label>
                  <div className="disc-inline-card">
                    <DisengagementFormFields f={cfDiscForm} setF={(updater) => setCfDiscForm(updater)} />
                  </div>
                </div>
              </>
            )}
            <div className="field">
              <label>New DB Type</label>
              <select className="select" value={cf.dbCategory}
                onChange={(e) => setCf((s) => ({ ...s, dbCategory: e.target.value as DbCategory }))}>
                {DB_TYPES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </>
        )}
        <div className="field">
          <label>Turnover Claim (₹L/mo)</label>
          <input className="input" type="number" value={cf.turnover} placeholder="200"
            onChange={(e) => setCf((s) => ({ ...s, turnover: e.target.value }))} />
        </div>
        <div className="field">
          <label>GST Number</label>
          <input className="input" value={cf.gst} placeholder="27ABCPD1234K1Z5"
            onChange={(e) => setCf((s) => ({ ...s, gst: e.target.value }))} />
        </div>

        <div className="field">
          <label>Required Documents <span className="muted-note" style={{ fontStyle: 'normal' }}>— attach now, or later on the review screen</span></label>
          <div className="ir-docs">
            {cfDocNames.map((name) => {
              const file = cfDocs[name]
              return (
                <div className={`ir-doc ${file ? 'ok' : 'miss'}`} key={name}>
                  <span className="ir-doc-dot">{file ? '✓' : '!'}</span>
                  <div className="ir-doc-body">
                    <div className="ir-doc-name">{name}</div>
                    {file && <div className="ir-doc-file">{file.name}</div>}
                  </div>
                  <div className="ir-doc-actions">
                    {!file && <Pill tone="warn">Not yet attached</Pill>}
                    <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
                      <Icon name="upload" size={12} /> {file ? 'Replace' : 'Upload'}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) setCfDocs((d) => ({ ...d, [name]: f })); e.target.value = '' }} />
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        </>)}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.4rem' }}>
          <Button variant="ghost" onClick={resetCreate}>Cancel</Button>
          {createTab === 'manual' && <Button disabled={!cf.firmName.trim()} onClick={createLeadManually}>Create lead →</Button>}
        </div>
      </Modal>
    </div>
  )
}

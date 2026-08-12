import './IntakeReview.css'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Modal, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import type { IconName } from '../components/ui/icons'
import { useApp, useMe } from '../store'
import { DEMO_USERS, ROLE_BY_CODE } from '../mock/roles'
import { EXTRACTIONS, DOC_DETAIL, applyDocOverrides, capturedCount, missingFieldLabels, mergedFields, recoveredFields } from '../mock/intake'
import type { Extraction, RequiredDoc } from '../mock/intake'
import type { ApplicationSubtype, CandidateCard, DisengagementForm } from '../types'
import { docBodyText, docIssuer, downloadDoc, fieldsFromDoc, focusRowKey, openDocPreview, sourceDocFor, sourceRowsFor } from '../lib/docSource'
import { applyPartnerToDiscForm, BLANK_DISC_FORM, DB_SUBTYPES, DisengagementFormFields, SUBTYPE_MAP } from '../components/DisengagementForm'
import { INFRA_FACTORS, SCORED_INFRA_KEYS, meanInfra, requiredInvestmentFor } from '../mock/onboarding'
import type { InfraState } from '../mock/onboarding'

const FIELD_ICON: Record<string, IconName> = {
  'Firm / Agency Name': 'partners', 'Contact Person': 'user', 'Phone Number': 'comms',
  'Email Address': 'mail', 'Town / City': 'target', State: 'target',
  'DB Type Requested': 'templates', 'Turnover Claim (₹/mo)': 'analytics', 'GST Number': 'documents',
}

const priorityPill = (p?: string) =>
  p === 'high' ? <Pill tone="crit" dot>High</Pill>
    : p === 'low' ? <Pill tone="neutral">Low</Pill>
      : <Pill tone="warn" dot>Normal</Pill>


export function IntakeReview() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const shortlistCandidate = useApp((s) => s.shortlistCandidate)
  const pushNotification = useApp((s) => s.pushNotification)
  const markIntakeProcessed = useApp((s) => s.markIntakeProcessed)
  const logAudit = useApp((s) => s.logAudit)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const me = useMe()
  const intakeDocOverrides = useApp((s) => s.intakeDocOverrides)
  const setIntakeDocOverride = useApp((s) => s.setIntakeDocOverride)
  // A document actually uploaded/replaced here previously (persisted — see store.ts) survives
  // EXTRACTIONS resetting to its base seed on every full page reload.
  if (EXTRACTIONS[id]) applyDocOverrides(EXTRACTIONS[id], intakeDocOverrides[id])
  const ext = EXTRACTIONS[id]
  // EXTRACTIONS is an in-memory cache populated as the Intake Inbox pulls /api/intake — a full
  // page reload (or opening this URL directly, e.g. from a shared link) clears that cache before
  // this screen ever gets a chance to fill it. Re-pull from the backend here too so a direct/
  // refreshed link to a real (server-known) intake item still resolves instead of 404ing.
  const [refetchDone, setRefetchDone] = useState(false)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (EXTRACTIONS[id]) { setRefetchDone(true); return }
    let alive = true
    fetch('/api/intake')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((items: Extraction[]) => {
        const found = items.find((it) => it.id === id)
        if (found) {
          applyDocOverrides(found, intakeDocOverrides[id])
          EXTRACTIONS[id] = found
        }
      })
      .catch(() => { /* server not running or item genuinely gone — fall through to not-found */ })
      .finally(() => { if (alive) { setRefetchDone(true); setTick((n) => n + 1) } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  // A formatted summary shows by default; the full original message is opt-in.
  const [showRaw, setShowRaw] = useState(false)
  const [notes, setNotes] = useState('')
  const [docs, setDocs] = useState<RequiredDoc[]>(() => EXTRACTIONS[id]?.documents ?? [])
  // Sync once the refetch above lands (the useState initializer above only ran at mount, when
  // ext was still missing).
  useEffect(() => {
    if (ext) setDocs(ext.documents ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext?.id])
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  // Location verification and manual field entry (document tamper checks live on their own
  // screen now — see Document Authenticity).
  const [locState, setLocState] = useState<'idle' | 'running' | 'done'>('idle')
  const [manualValues, setManualValues] = useState<Record<string, string>>({})
  const [editField, setEditField] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  // Source document preview — opened from a field's "Source" tag to check the field's
  // claimed value against the document it actually came from.
  // field is set when opened from a specific extracted field's "Source" link (highlights just
  // that one row); left undefined when opened from the Required Documents "View" button, which
  // highlights every field actually extracted from that document.
  const [sourceDoc, setSourceDoc] = useState<{ doc: RequiredDoc; field?: string } | null>(null)
  // Requesting missing fields is framed as replying to the incoming mail — the composer
  // opens with the sender/subject already addressed and every missing field pre-checked.
  const [whyOpen, setWhyOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestSel, setRequestSel] = useState<Set<string>>(new Set())
  const [requestMsg, setRequestMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [mailNote, setMailNote] = useState<string | null>(null)
  // Real uploaded file bytes (session-only) — keyed by doc name, so View/Download open the
  // actual file the user attached instead of a synthetic mock PDF, and the fields shown for it
  // are genuinely pulled from that file's own content (backend/api/extract-document).
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File>>({})
  const [uploadedFields, setUploadedFields] = useState<Record<string, { label: string; value: string; ok: boolean }[]>>({})
  const [extractingDoc, setExtractingDoc] = useState<string | null>(null)
  // New DB / Replacement / Additional — an emailed enquiry has no way to convey this on its own
  // (the extractor can't reliably infer it from free-text body copy), so it's set here just like
  // Create Lead's own picker, with the same OLD DB Code lookup + auto-filled Disengagement Form.
  const [subtype, setSubtype] = useState<ApplicationSubtype>(() => EXTRACTIONS[id]?.subtype ?? 'new')
  const [oldDbCode, setOldDbCode] = useState(() => EXTRACTIONS[id]?.oldDbCode ?? '')
  const [oldDbName, setOldDbName] = useState(() => EXTRACTIONS[id]?.oldDbName ?? '')
  const [additionalReason, setAdditionalReason] = useState(() => EXTRACTIONS[id]?.additionalReason ?? '')
  const [discForm, setDiscForm] = useState<DisengagementForm>(() => EXTRACTIONS[id]?.discontinuationForm ?? BLANK_DISC_FORM)
  const allPartners = useApp((s) => s.partners)
  const codedDistributors = allPartners.filter((p) => p.partnerType === 'distributor' && p.dbCode)
  const dbSubtypeLabel = (Object.entries(SUBTYPE_MAP).find(([, v]) => v === subtype)?.[0] ?? 'New DB') as typeof DB_SUBTYPES[number]

  if (!ext) {
    if (!refetchDone) {
      return (
        <div>
          <div className="page-head"><h1>Loading intake item…</h1></div>
        </div>
      )
    }
    return (
      <div>
        <div className="page-head"><h1>Intake item not found <span className="page-info-ic" title="This intake item isn't available (it may have been a session-only upload)."><Icon name="help" size={13} /></span></h1></div>
        <Button onClick={() => navigate('/intake-inbox')}>← Back to Intake Inbox</Button>
      </div>
    )
  }

  const total = ext.fields.length
  // Manually entered values count as captured and drop off the missing list.
  const manualCount = Object.values(manualValues).filter((v) => v.trim()).length
  const captured = Math.min(total, capturedCount(ext) + manualCount)
  const confPct = ext.confidencePct ?? 0
  const confTone = confPct >= 85 ? 'good' : confPct >= 60 ? 'warn' : 'crit'
  const confLabel = confPct >= 85 ? 'High' : confPct >= 60 ? 'Medium' : 'Low'
  const docsReceived = docs.filter((d) => d.received).length
  const missing = missingFieldLabels(ext).filter((l) => !manualValues[l]?.trim())
  const missingDocs = docs.filter((d) => !d.received).map((d) => d.name)
  // What the "request missing info" reply offers to ask for — fields AND required documents
  // still outstanding, not just fields.
  const missingAll = [...missing, ...missingDocs]
  const saveManual = (label: string) => {
    if (!editVal.trim()) return
    setManualValues((m) => ({ ...m, [label]: editVal.trim() }))
    setEditField(null)
    setEditVal('')
  }
  // ASE/ASM (and admin) can attach a missing document (or replace an already-received one)
  // right here. The real uploaded file is sent to the backend to genuinely extract its fields
  // rather than showing a synthetic mock preview, AND its bytes are persisted (as a data URL) in
  // intakeDocOverrides so it survives a page reload instead of only living for this session.
  // Channel Development also gets upload access, covering leads an ASE/ASM hasn't picked up yet.
  const canUpload = viewingAs === 'ase_asm' || viewingAs === 'admin' || viewingAs === 'channel_dev'
  const readAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const uploadDoc = async (docName: string, file: File) => {
    const dataUrl = await readAsDataUrl(file).catch(() => undefined)
    const updated: RequiredDoc = {
      ...(docs.find((d) => d.name === docName) ?? { name: docName, received: false }),
      received: true, file: file.name, dataUrl,
      detail: `${DOC_DETAIL[docName] ?? ''} Uploaded just now from this review.`.trim(),
    }
    const next = docs.map((d) => (d.name === docName ? updated : d))
    setDocs(next)
    ext.documents = next
    ext.attachments = [...(ext.attachments ?? []), file.name]
    setIntakeDocOverride(id, updated)
    setUploadedFiles((f) => ({ ...f, [docName]: file }))
    setUploadNote(`"${file.name}" attached as ${docName} — reading the document…`)
    setExtractingDoc(docName)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/extract-document', { method: 'POST', body: form })
      const result = await res.json().catch(() => null)
      if (res.ok && Array.isArray(result?.fields)) {
        setUploadedFields((f) => ({ ...f, [docName]: result.fields }))
        const found = result.fields.filter((fl: { ok: boolean }) => fl.ok).length
        setUploadNote(`"${file.name}" attached as ${docName} — found ${found} field${found === 1 ? '' : 's'} in the document.`)
      } else {
        setUploadNote(`"${file.name}" attached as ${docName} — couldn't read fields from this file.`)
      }
    } catch {
      setUploadNote(`"${file.name}" attached as ${docName} — attached, but couldn't reach the extraction service.`)
    } finally {
      setExtractingDoc(null)
    }
  }
  // Clears an attached document back to "Not yet attached" — drops the persisted override too,
  // so it stays cleared after a page reload instead of the old file silently reappearing.
  const removeDoc = (docName: string) => {
    const cleared: RequiredDoc = { name: docName, received: false }
    const next = docs.map((d) => (d.name === docName ? cleared : d))
    setDocs(next)
    ext.documents = next
    const removedFile = docs.find((d) => d.name === docName)?.file
    if (removedFile) ext.attachments = (ext.attachments ?? []).filter((a) => a !== removedFile)
    setIntakeDocOverride(id, cleared)
    setUploadedFiles((f) => { const { [docName]: _, ...rest } = f; return rest })
    setUploadedFields((f) => { const { [docName]: _, ...rest } = f; return rest })
    setUploadNote(`${docName} removed.`)
  }

  // Build the key details shown on a document's preview page from the extracted fields.
  // Summary of the received message: the Intake Agent's read if present, otherwise
  // composed from the extracted fields. Manually entered values take precedence.
  const mval = (re: RegExp) =>
    Object.entries(manualValues).find(([l, v]) => re.test(l) && v.trim())?.[1]
    ?? mergedFields(ext).find((f) => re.test(f.label) && f.ok)?.value
  const messageSummary = ext.summary ?? (() => {
    const firm = mval(/firm|agency/i) ?? ext.source
    const town = mval(/town/i)
    const state = mval(/^state/i)
    const dbType = mval(/db type/i)
    const contact = mval(/contact/i)
    const email = mval(/email/i)
    return [
      `${firm}${town ? ` (${town}${state ? ', ' + state : ''})` : ''} is requesting appointment${dbType ? ` as ${dbType}` : ' as a distributor'}.`,
      contact ? `Contact: ${contact}${email ? ` · ${email}` : ''}.` : '',
      docs.length ? `${docs.filter((d) => d.received).length} of ${docs.length} required documents attached.` : '',
    ].filter(Boolean).join(' ')
  })()
  // The full message, broken into readable paragraphs (raw mails arrive as one block).
  const messageParagraphs = (() => {
    const raw = ext.raw ?? ''
    const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
    if (blocks.length > 1) return blocks
    const sentences = raw.split(/(?<=[.!?])\s+/).filter(Boolean)
    const out: string[] = []
    for (let i = 0; i < sentences.length; i += 2) out.push(sentences.slice(i, i + 2).join(' '))
    return out
  })()

  // Verify the lead's claimed location against the GST registration & godown address.
  // (Document tamper/authenticity checks moved to their own screen — Document Authenticity.)
  const claimedTown = mval(/town/i)
  const claimedState = mval(/^state/i)
  const runLoc = () => {
    setLocState('running')
    setTimeout(() => {
      setLocState('done')
      logAudit({
        actor: 'Document Intelligence Agent', kind: 'ai',
        action: claimedTown ? `Verified location — ${claimedTown}${claimedState ? ', ' + claimedState : ''}` : 'Location check inconclusive (no town captured)',
        entity: ext.source,
      })
    }, 1100)
  }

  // Carry the *reviewed* intake's extracted data into New Application, so the wizard opens on
  // this lead (not a pre-seeded one) with the recommendation form prefilled.
  const createLead = () => {
    // recovery-aware: a value the agent pulled from an attached document prefills the form,
    // and anything the ASE typed in manually wins over both
    const merged = mergedFields(ext)
    const val = (re: RegExp) =>
      Object.entries(manualValues).find(([l, v]) => re.test(l) && v.trim())?.[1]
      ?? merged.find((f) => re.test(f.label) && f.ok)?.value
    const name = val(/firm|agency/i) ?? ext.source
    const town = (val(/town/i) ?? 'Nashik').split(',')[0].trim()
    const dbType = val(/db type/i)
    const dbCategory = dbType && /GT DB|GM Excl|Traders/i.test(dbType) ? dbType : 'GT DB (with CSO/DSM)'
    const turnoverNum = parseFloat((val(/turnover/i) ?? '').replace(/[^\d.]/g, ''))
    const turnoverMonthly = Number.isFinite(turnoverNum) && turnoverNum > 0 ? turnoverNum : 150
    // Exact-label lookup (not the fuzzy regex `val()` above) for the real workbook's own
    // Background/Coverage/Infrastructure/Financials fields — several share words with each other
    // ("turnover", "coverage") so a substring match would grab the wrong one. Same manual-value-
    // wins-over-extracted precedence as `val()`. Falls through to undefined when the intake wasn't
    // sourced from the real workbook (email, manual entry) — the flat defaults below still apply.
    const exact = (label: string) =>
      Object.entries(manualValues).find(([l, v]) => l === label && v.trim())?.[1]
      ?? merged.find((f) => f.label === label && f.ok)?.value
    const numOf = (label: string) => { const n = parseFloat((exact(label) ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : undefined }
    const expectedRcplTurnover = numOf('Expected RCPL Turnover (₹L/mo)') ?? Math.round(turnoverMonthly * 0.2)
    const coverageOutlets = numOf("Overall Firm's Coverage (OL)") ?? 1000
    const ownFunds = numOf('Total Own Funds/Borrowed (₹L)')
    const ccLimit = numOf('CC Limit (₹L)')
    const infraFactors: InfraState = {}
    for (const f of INFRA_FACTORS) { const v = numOf(`Infra — ${f.label}`); if (v != null) infraFactors[f.key] = v }
    // Only the 7 SCORED_INFRA_KEYS (not all 8 INFRA_FACTORS) — "Reputation in the marketplace" is
    // a section-divider label in the real workbook, not a rated field with its own input cell, so
    // it can never actually be captured. Requiring all 8 here meant this was ALWAYS false for
    // every real-workbook upload, silently dropping the real infra/financial figures onto every
    // lead (they fell back to the flat 7/10 default instead) — exactly why different views ended
    // up showing different numbers for the same lead.
    const hasInfra = SCORED_INFRA_KEYS.every((k) => infraFactors[k] != null)
    // Real per-factor Channel Management Evaluation + Own Funds/CC Limit split from the uploaded
    // workbook, when it carried them — otherwise the same flat 7/10 · 100% defaults as before
    // (a fresh lead that hasn't been evaluated yet, same reasoning as isBestMatch below).
    const infraScore = hasInfra ? meanInfra(infraFactors) : 7
    const finEvalPct = ownFunds != null && ccLimit != null
      ? Math.round(((ownFunds + ccLimit) / requiredInvestmentFor(turnoverMonthly, expectedRcplTurnover)) * 100)
      : 100
    const id = `intake-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`
    const intakeLead: CandidateCard = {
      id, name, town, dbCategory,
      turnoverMonthly, expectedRcplTurnover, coverageOutlets,
      // isBestMatch is a real evaluation outcome, not a default — a freshly created lead hasn't
      // been evaluated yet (that happens later, on the Evaluate step), so it starts unset rather
      // than unconditionally badged "Best Match" regardless of what its numbers turn out to be.
      infraScore, finEvalPct, stage: 'open', confidencePct: ext.confidencePct ?? 80,
      ...(hasInfra ? { infraFactors } : {}),
      ...(ownFunds != null ? { ownFunds } : {}),
      ...(ccLimit != null ? { ccLimit } : {}),
      // Both the Infrastructure and Financials sections came from the real workbook, not a
      // manual guess — lock New Application's sliders for this lead so its figures stay
      // exactly what the field team submitted.
      evalFromSheet: hasInfra && ownFunds != null && ccLimit != null,
      userCreated: true, createdBy: viewingAs, createdById: me?.id, createdAt: Date.now(), sourceIntakeId: ext.id,
      // Set directly from this screen's own New DB / Replacement / Additional picker above
      // (or Create Lead's, if that's where this lead came from) rather than re-parsed out of
      // the display fields — "Replacement DB"/"Additional DB" don't match dbCategory's regex
      // above and would otherwise get silently dropped.
      subtype: subtype === 'new' ? undefined : subtype,
      oldDbCode: subtype === 'replacement' ? oldDbCode || undefined : undefined,
      oldDbName: subtype === 'replacement' ? oldDbName || undefined : undefined,
      additionalReason: subtype === 'additional' ? additionalReason || undefined : undefined,
      discontinuationForm: subtype === 'replacement' && discForm.distributorNameAddressDbCode.trim() && discForm.dateOfAppointment.trim()
        ? discForm : undefined,
    }
    const fieldOverrides: Record<string, string> = {}
    const setOv = (label: string, v?: string) => { if (v) fieldOverrides[label] = v }
    setOv('Agency / Firm name', name)
    setOv('Town', town)
    setOv('State', val(/^state/i))
    setOv('Phone Number', val(/phone/i))
    if (Number.isFinite(turnoverNum) && turnoverNum > 0) setOv('Total Monthly Turnover of the Firm', String(turnoverNum))
    // Persist the lead into the shared pipeline + comparison shortlist right away, so it shows on
    // the Leads page and Channel Development sees the same shortlist to compare.
    shortlistCandidate(intakeLead)
    // The intake item is consumed — it becomes a lead and leaves the Intake Inbox.
    markIntakeProcessed(ext.id)
    // Hand-off signal addressed to Trade Marketing (Channel Development) — they pick the
    // shortlist up in New Application.
    pushNotification({
      title: 'Lead shortlisted — please check',
      body: `${name} (${town}) has been shortlisted by ${DEMO_USERS[viewingAs].name} (${ROLE_BY_CODE[viewingAs].label}). Review and compare it in New Application.`,
      href: '/new-application',
      forRole: 'channel_dev',
    })
    // ASE/ASM creates the lead but doesn't run the wizard — they land on Leads, where the created
    // lead is visible; Channel Development picks up the shortlist in New Application.
    if (viewingAs === 'ase_asm') {
      navigate('/leads')
      return
    }
    navigate('/new-application', { state: { partnerType: ext.partnerType ?? 'distributor', intakeLead, fieldOverrides, intakeDocs: docs } })
  }
  // Fetches a real email-captured attachment's bytes from the backend (see
  // backend/email_service/attachment_store.py) — null if it's not on file there (e.g. this
  // item predates that feature, or the doc was never actually received).
  const fetchRealDocBlob = async (doc: RequiredDoc): Promise<Blob | null> => {
    if (!doc.file) return null
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(ext.id)}/attachment?filename=${encodeURIComponent(doc.file)}`)
      return res.ok ? await res.blob() : null
    } catch {
      return null
    }
  }
  // Opens the REAL document when one is available — a session-only manual upload first, then
  // the backend's saved email attachment (via the same highlighted /document-viewer the Source
  // modal uses, so "View full document" doesn't drop the highlight the user just saw) —
  // falling back to the synthetic mock preview only if neither exists (e.g. this item predates
  // real-attachment storage).
  const viewDoc = async (doc: RequiredDoc, field?: string) => {
    const real = uploadedFiles[doc.name]
    if (real) {
      const url = URL.createObjectURL(real)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return
    }
    if (doc.file) {
      const labels = field ? [field] : fieldsFromDoc(ext, doc)
      const values = labels.map((label) => mergedFields(ext).find((f) => f.label === label)?.value).filter((v): v is string => !!v)
      const qs = new URLSearchParams({ itemId: ext.id, filename: doc.file, title: doc.name })
      values.forEach((v) => qs.append('q', v))
      window.open(`/document-viewer?${qs.toString()}`, '_blank')
      return
    }
    openDocPreview(ext, doc)
  }
  const downloadDocFile = async (doc: RequiredDoc) => {
    const real = uploadedFiles[doc.name]
    if (real) {
      const url = URL.createObjectURL(real)
      const a = document.createElement('a')
      a.href = url
      a.download = real.name
      a.click()
      URL.revokeObjectURL(url)
      return
    }
    const blob = await fetchRealDocBlob(doc)
    if (blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.file ?? doc.name
      a.click()
      URL.revokeObjectURL(url)
      return
    }
    downloadDoc(ext, doc)
  }
  const partnerFirmName = ext.fields.find((f) => /firm|agency/i.test(f.label) && f.ok)?.value ?? ext.source
  const draftFor = (fields: string[]) =>
    `Hi — thanks for reaching out. To move ahead we still need: ${fields.join(', ')}. Could you share these when you get a chance?`
  const openRequest = () => {
    setRequestSel(new Set(missingAll))
    setRequestMsg(draftFor(missingAll))
    setSendError(null)
    setRequestOpen(true)
  }
  // Sends a real reply over SMTP (backend/mailer.py) to the sender's own address — this is a
  // mail request, not an internal Communication-agent ping.
  const sendRequest = async () => {
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/mail/reply', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: ext.source, subject: `Re: ${ext.title}`, text: requestMsg.trim() || draftFor(Array.from(requestSel)),
          // Lets the server recognize the distributor's eventual reply and merge it back into
          // this same intake item instead of filing it as a new, unrelated one.
          itemId: ext.id,
          // Any requested items that are required documents (not fields) get a "what this
          // should look like" sample PDF attached server-side (backend/email_service/sample_forms.py).
          attachDocs: missingDocs.filter((d) => requestSel.has(d)),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `send failed (${res.status})`)
      logAudit({
        actor: DEMO_USERS[viewingAs].name, kind: 'human',
        action: `Emailed ${ext.source} requesting missing info — ${Array.from(requestSel).join(', ')}`,
        entity: partnerFirmName,
      })
      setRequestOpen(false)
      setMailNote(`Reply sent to ${ext.source} requesting: ${Array.from(requestSel).join(', ')}.`)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }
  const toggleRequestField = (label: string) => {
    setRequestSel((sel) => {
      const next = new Set(sel)
      if (next.has(label)) next.delete(label); else next.add(label)
      setRequestMsg(draftFor(Array.from(next)))
      return next
    })
  }

  // The agency/firm name if the extraction captured one — not ext.source, which is just the
  // from-email or file name (e.g. "excel-upload"/"manual-entry" for a non-email intake), so this
  // heading reads as "Review — Suvarna Agencies" instead of "Review — excel-upload".
  const displayName = mergedFields(ext).find((f) => /firm|agency/i.test(f.label) && f.ok)?.value ?? ext.source

  return (
    <div className="ir">
      <div className="page-head">
        <div className="row-between">
          <h1>Review — {displayName}</h1>
          <Button variant="text" onClick={() => navigate('/intake-inbox', { state: { returnTab: ext.channel } })}>✕ Close</Button>
        </div>
      </div>

      {/* subject + received */}
      <Card>
        <div className="ir-subject">
          <span className="ir-subject-ic"><Icon name={ext.channel === 'email' ? 'mail' : 'documents'} size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ir-subject-label">{ext.channel === 'email' ? 'Email Subject' : 'File'}</div>
            <div className="ir-subject-text">"{ext.title}"</div>
          </div>
          <div className="ir-received">
            <div className="ir-subject-label">Received</div>
            <div className="ir-received-row"><b>{ext.receivedAt}</b> <Pill tone="neutral">{ext.channel === 'email' ? 'Email' : 'Upload'}</Pill></div>
          </div>
        </div>
      </Card>

      {ext.duplicate && (
        <div className="ir-dup">
          <span className="ir-dup-ic"><Icon name="flag" size={14} /></span>
          <div style={{ flex: 1 }}>
            <div className="ir-dup-title">Possible duplicate</div>
            <div className="ir-dup-note">{ext.duplicate}</div>
          </div>
          <Button variant="ghost" size="sm"><Icon name="external" size={13} /> View existing record</Button>
        </div>
      )}

      {/* intake details — agent summary + metadata + attachments */}
      <Card>
        <div className="ir-card-title">Intake details</div>
        {ext.summary && (
          <div className="ir-summary">
            <span className="ir-summary-tag"><Icon name="spark" size={12} /> Agent summary</span>
            <span>{ext.summary}</span>
          </div>
        )}
        <div className="ir-meta-grid">
          <div className="ir-meta"><div className="k">Received</div><div className="v">{ext.receivedFull ?? ext.receivedAt}</div></div>
          <div className="ir-meta"><div className="k">Channel</div><div className="v">{ext.channel === 'email' ? 'Email' : 'Manual upload'}</div></div>
          <div className="ir-meta"><div className="k">Priority</div><div className="v">{priorityPill(ext.priority)}</div></div>
          <div className="ir-meta"><div className="k">Region</div><div className="v">{ext.region ?? '—'}</div></div>
          <div className="ir-meta"><div className="k">Assigned to</div><div className="v">{ext.assignedTo ?? 'Unassigned'}</div></div>
          <div className="ir-meta"><div className="k">Partner type</div><div className="v">{ext.partnerType === 'vendor' ? 'Vendor' : 'Distributor'}</div></div>
        </div>
        {ext.attachments && ext.attachments.length > 0 && (
          <div className="ir-attach">
            <div className="k">Attachments ({ext.attachments.length})</div>
            <div className="ir-attach-list">
              {ext.attachments.map((a) => (
                <span className="ir-attach-chip" key={a}><Icon name="documents" size={12} /> {a}</span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* confidence + actions */}
      <Card>
        <div className="ir-actions">
          <div className="ir-metric">
            <div className="ir-metric-label">Extraction confidence</div>
            <button type="button" className="ir-why-btn" onClick={() => setWhyOpen(true)}
              title="See why — which fields were found and missed">
              <Pill tone={confTone} dot>{confLabel} ({confPct}%)</Pill>
              <Icon name="help" size={12} />
            </button>
          </div>
          <div className="ir-metric">
            <div className="ir-metric-label">Fields captured</div>
            <div className="ir-metric-value">{captured} / {total}</div>
          </div>
          <div className="ir-actions-btns">
            {missingAll.length > 0 && <Button variant="ghost" size="sm" onClick={openRequest}><Icon name="send" size={13} /> Request missing info</Button>}
            <Button size="sm" onClick={createLead}><Icon name="approvals" size={13} /> Review &amp; create lead</Button>
          </div>
        </div>
      </Card>

      {uploadNote && (
        <div className="notify-bar" style={{ marginBottom: '1rem' }}>
          <Icon name="upload" size={14} /> {uploadNote}
        </div>
      )}
      {mailNote && (
        <div className="notify-bar" style={{ marginBottom: '1rem' }}>
          <Icon name="send" size={14} /> {mailNote}
        </div>
      )}

      <div className="ir-cols">
        {/* Extracted info / candidates */}
        <Card>
          <div className="ir-card-title">{ext.candidates ? `Detected candidates (${ext.candidates.length})` : 'Extracted Information'}</div>
          {ext.candidates ? (
            <div className="ir-cands">
              {ext.candidates.map((c) => (
                <div className="ir-cand" key={c.name}>
                  <span className="ir-cand-av">{c.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                  <div><div className="ir-cand-nm">{c.name}</div><div className="ir-cand-tw">{c.town}</div></div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="ir-fields">
                {mergedFields(ext).map((f) => {
                  const manual = manualValues[f.label]?.trim()
                  const hasVal = f.ok || !!manual
                  const srcDoc = !manual ? sourceDocFor(docs, f) : undefined
                  return (
                    <div className="ir-field" key={f.label}>
                      <span className={`ir-field-ic ${hasVal ? '' : 'miss'}`}><Icon name={FIELD_ICON[f.label] ?? 'documents'} size={15} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="ir-field-k">{f.label}</div>
                        <div className={`ir-field-v ${hasVal ? '' : 'miss'}`}>
                          {manual ?? f.value}
                          {manual && <span className="ir-recovered" title="Entered manually by you"><Icon name="user" size={10} /> manual</span>}
                          {!manual && srcDoc && (
                            <button className="ir-recovered ir-source-btn" title={`Check against ${srcDoc.name}`} onClick={() => setSourceDoc({ doc: srcDoc, field: f.label })}>
                              <Icon name="documents" size={10} /> {f.recoveredFrom ? `from ${f.recoveredFrom}` : 'Source'}
                            </button>
                          )}
                          {!manual && !srcDoc && f.recoveredFrom && <span className="ir-recovered" title={`Captured from ${f.recoveredFrom}`}><Icon name="spark" size={10} /> from {f.recoveredFrom}</span>}
                          {!hasVal && (editField === f.label ? (
                            <span className="ir-manual-edit">
                              <input autoFocus value={editVal} placeholder={f.label}
                                onChange={(e) => setEditVal(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveManual(f.label); if (e.key === 'Escape') setEditField(null) }} />
                              <Button size="sm" onClick={() => saveManual(f.label)}>Save</Button>
                              <Button variant="text" size="sm" onClick={() => setEditField(null)}>Cancel</Button>
                            </span>
                          ) : (
                            <>
                              <Pill tone="crit">Missing</Pill>
                              <button className="ir-manual-btn" onClick={() => { setEditField(f.label); setEditVal('') }}>+ Enter manually</button>
                            </>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {recoveredFields(ext).length > 0 && (
                <p className="ir-recovered-note"><Icon name="spark" size={12} /> {recoveredFields(ext).length} field{recoveredFields(ext).length > 1 ? 's' : ''} the email didn't include {recoveredFields(ext).length > 1 ? 'were' : 'was'} captured from the attached documents.</p>
              )}
              {ext.raw && (
                <div className="ir-raw">
                  <div className="ir-msg-title">
                    <Icon name={ext.channel === 'email' ? 'mail' : 'documents'} size={13} /> {ext.channel === 'email' ? 'Received message' : 'File content'}
                  </div>
                  <div className="ir-msg-summary">
                    <span className="ir-summary-tag"><Icon name="spark" size={12} /> Summary</span>
                    <p>{messageSummary}</p>
                  </div>
                  {ext.channel === 'email' && missingAll.length > 0 && (
                    <div className="ir-mail-missing">
                      <div className="ir-mail-missing-head">
                        <Icon name="flag" size={13} />
                        <span>This email is missing {missingAll.length} item{missingAll.length > 1 ? 's' : ''}
                          {missing.length > 0 && missingDocs.length > 0 ? ` (${missing.length} field${missing.length > 1 ? 's' : ''}, ${missingDocs.length} document${missingDocs.length > 1 ? 's' : ''})` : ''}
                        </span>
                      </div>
                      <div className="ir-mail-missing-chips">
                        {missingAll.map((m) => <span className="ir-mail-missing-chip" key={m}>{m}</span>)}
                      </div>
                      <Button variant="ghost" size="sm" onClick={openRequest}>
                        <Icon name="send" size={13} /> Reply &amp; request these
                      </Button>
                    </div>
                  )}
                  <button className="ir-raw-toggle" onClick={() => setShowRaw((v) => !v)}>
                    {showRaw ? '▲ Hide full message' : `▾ View full ${ext.channel === 'email' ? 'message' : 'content'}`}
                  </button>
                  {showRaw && (
                    <div className="ir-raw-body">
                      {messageParagraphs.map((p, i) => <p key={i}>{p}</p>)}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Card>

        {/* Documents + notes */}
        <div className="ir-col">
          {(ext.partnerType ?? 'distributor') === 'distributor' && (
            <Card>
              <div className="ir-card-head">
                <span className="ir-card-title">New DB / Replacement / Additional DB</span>
              </div>
              <div className="field">
                <select className="select" value={dbSubtypeLabel}
                  onChange={(e) => setSubtype(SUBTYPE_MAP[e.target.value as typeof DB_SUBTYPES[number]])}>
                  {DB_SUBTYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              {subtype === 'additional' && (
                <div className="field">
                  <label>If Additional DB, mention reason</label>
                  <input className="input" value={additionalReason} placeholder="New beat — GM Excl DB"
                    onChange={(e) => setAdditionalReason(e.target.value)} />
                </div>
              )}
              {subtype === 'replacement' && (
                <>
                  <div className="field">
                    <label>If Replacement, mention OLD DB Code</label>
                    <select className="select" value={oldDbCode}
                      onChange={(e) => {
                        const code = e.target.value
                        const picked = codedDistributors.find((p) => p.dbCode === code)
                        setOldDbCode(code)
                        setOldDbName(picked?.legalName ?? '')
                        if (picked) setDiscForm((s) => applyPartnerToDiscForm(s, picked))
                      }}>
                      <option value="">Select the DB being replaced…</option>
                      {codedDistributors.map((p) => (
                        <option key={p.id} value={p.dbCode}>{p.dbCode} — {p.legalName} ({p.town})</option>
                      ))}
                    </select>
                    {oldDbName && (
                      <p className="muted-note" style={{ margin: '0.4rem 0 0' }}><Icon name="check" size={12} /> Replacing <strong>{oldDbName}</strong> ({oldDbCode}).</p>
                    )}
                    <p className="muted-note" style={{ margin: '0.4rem 0 0' }}>
                      Pulled from the Partners directory — picking a DB pre-fills the sheet below with what's already on file for it.
                    </p>
                  </div>
                  <div className="field">
                    <label>If Replacement, fill up next sheet — Distributor Disengagement Recommendation Form</label>
                    <div className="disc-inline-card">
                      <DisengagementFormFields f={discForm} setF={setDiscForm} />
                    </div>
                  </div>
                </>
              )}
            </Card>
          )}
          {docs.length > 0 && (
            <Card>
              <div className="ir-card-head">
                <span className="ir-card-title">Required Documents</span>
                <span className="ir-card-meta">{docsReceived} / {docs.length} received</span>
              </div>
              <div className="ir-docs">
                {docs.map((d) => (
                  <DocRow key={d.name} doc={d}
                    onView={() => setSourceDoc({ doc: d })}
                    onDownload={() => downloadDocFile(d)}
                    onUpload={canUpload ? (file) => uploadDoc(d.name, file) : undefined}
                    onRemove={canUpload ? () => removeDoc(d.name) : undefined} />
                ))}
              </div>
            </Card>
          )}
          <Card>
            <div className="ir-card-head">
              <span className="ir-card-title"><Icon name="target" size={14} /> Location verification</span>
            </div>
            <p className="di-blurb">Cross-checks the lead's claimed town/state against the GST registration &amp; godown address.</p>
            <div className="di-loc">
              {locState === 'done' ? (
                claimedTown
                  ? <Pill tone="good" dot>Verified — {claimedTown}{claimedState ? `, ${claimedState}` : ''} matches the GST registration &amp; godown address</Pill>
                  : <Pill tone="warn" dot>Inconclusive — no town/city captured; enter it manually and re-check</Pill>
              ) : (
                <Button variant="ghost" size="sm" onClick={runLoc} disabled={locState === 'running'}>
                  <Icon name="target" size={13} /> {locState === 'running' ? 'Checking location…' : "Verify lead's location"}
                </Button>
              )}
            </div>
            <p className="muted-note" style={{ marginTop: '0.7rem' }}>
              Document tampering/authenticity checks moved to their own screen — <Link to="/document-authenticity">Document Authenticity →</Link>
            </p>
          </Card>

          <Card>
            <div className="ir-card-title">Notes</div>
            <textarea className="ir-notes" maxLength={500} placeholder="Add your notes here…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="ir-notes-count">{notes.length} / 500</div>
          </Card>
        </div>
      </div>

      <div className="ir-foot">
        <div>
          <div className="ir-foot-title">Next step</div>
          <div className="ir-foot-note">If everything looks good, you can create a lead. You can always edit details later.</div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <Button variant="ghost" onClick={() => navigate('/intake-inbox', { state: { returnTab: ext.channel } })}>Close</Button>
          <Button onClick={createLead}>Review &amp; create lead →</Button>
        </div>
      </div>

      <Modal open={whyOpen} onClose={() => setWhyOpen(false)} title="Why this confidence score?">
        <p className="ir-why-lead">
          Extraction confidence is the share of expected fields the agent could read from the
          original {ext.channel === 'document' ? 'document' : 'email'}. It measures how
          <b> complete</b> the extraction is — not whether each value is correct.
        </p>
        <div className="ir-why-formula">
          <span><b>{ext.fields.filter((f) => f.ok).length}</b> of <b>{ext.fields.length}</b> fields found</span>
          <span className="ir-why-eq">= {confPct}%</span>
        </div>
        <div className="ir-why-grid">
          {ext.fields.map((f) => (
            <div key={f.label} className={`ir-why-row ${f.ok ? 'ok' : 'no'}`}>
              <Icon name={f.ok ? 'check' : 'close'} size={13} />
              <span className="ir-why-lbl">{f.label}</span>
              <span className="ir-why-val">{f.ok ? f.value : 'Not found'}</span>
            </div>
          ))}
        </div>
        {(() => {
          const rec = recoveredFields(ext)
          const man = Object.entries(manualValues).filter(([, v]) => v.trim())
          if (rec.length === 0 && man.length === 0) return null
          const bits: string[] = []
          if (rec.length) bits.push(`${rec.length} recovered from documents`)
          if (man.length) bits.push(`${man.length} entered manually`)
          return (
            <p className="ir-why-note">
              Since extraction, {bits.join(' and ')} — so <b>Fields captured</b> now reads {captured}/{total},
              though the original extraction score above is unchanged.
            </p>
          )
        })()}
      </Modal>

      <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title="Reply — request missing info">
        <div className="ir-reply-meta">
          <div><span className="k">To</span> {ext.source}</div>
          <div><span className="k">Subject</span> Re: {ext.title}</div>
        </div>
        <div className="field">
          <label>Missing fields &amp; documents to request</label>
          <div className="ir-reply-checks">
            {missingAll.map((m) => (
              <label className="ir-reply-check" key={m}>
                <input type="checkbox" checked={requestSel.has(m)} onChange={() => toggleRequestField(m)} />
                <span>{m}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Message</label>
          <textarea className="input" style={{ minHeight: 110, resize: 'vertical' }} value={requestMsg}
            onChange={(e) => setRequestMsg(e.target.value)} />
        </div>
        <p className="muted-note" style={{ marginBottom: '0.4rem' }}>
          Sends as a real email reply to {ext.source} over SMTP.
          {missingDocs.some((d) => requestSel.has(d)) && (
            <> A sample of the expected format will be attached for: {missingDocs.filter((d) => requestSel.has(d)).join(', ')}.</>
          )}
        </p>
        {sendError && (
          <div className="notify-bar" style={{ marginBottom: '0.7rem' }}>
            <Icon name="flag" size={14} /> Couldn't send: {sendError}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Button variant="ghost" onClick={() => setRequestOpen(false)}>Cancel</Button>
          <Button disabled={sending || requestSel.size === 0 || !requestMsg.trim()} onClick={sendRequest}>
            <Icon name="send" size={13} /> {sending ? 'Sending…' : 'Send request'}
          </Button>
        </div>
      </Modal>

      <Modal open={!!sourceDoc} onClose={() => setSourceDoc(null)} title={sourceDoc?.doc.name ?? 'Source document'}>
        {sourceDoc && (() => {
          // A manually-uploaded doc (this session) has real extracted fields — show those
          // instead of the synthetic mock rows, since they're genuinely pulled from the file.
          const realFields = uploadedFields[sourceDoc.doc.name]
          // A single row when opened from one field's "Source" link; every row this document
          // actually backs (e.g. GSTIN, Legal Name) when opened from the document's own "View".
          const highlightKeys = new Set(
            sourceDoc.field
              ? [focusRowKey(sourceDoc.field)].filter((k): k is string => !!k)
              : fieldsFromDoc(ext, sourceDoc.doc).map((label) => focusRowKey(label)).filter((k): k is string => !!k),
          )
          return (
          <div className="ir-source">
            <div className="ir-source-issuer"><Icon name="shield" size={13} /> {docIssuer(sourceDoc.doc.name)}</div>
            {extractingDoc === sourceDoc.doc.name && <p className="muted-note">Reading the document…</p>}
            {realFields ? (
              <>
                <p className="muted-note" style={{ marginBottom: '0.4rem' }}>Fields found in the actual uploaded file:</p>
                <div className="ir-source-rows">
                  {realFields.map((f) => (
                    <div className={`ir-source-row ${f.ok ? 'hi' : ''}`} key={f.label}>
                      <span className="k">{f.label}{f.ok && <span className="ir-source-tag">found in this doc</span>}</span>
                      <span className="v">{f.ok ? f.value : <Pill tone="warn">Not found</Pill>}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="ir-source-rows">
                  {sourceRowsFor(ext, sourceDoc.doc).map((r) => {
                    const hi = highlightKeys.has(r.k)
                    return (
                      <div className={`ir-source-row ${hi ? 'hi' : ''}`} key={r.k}>
                        <span className="k">{r.k}{hi && <span className="ir-source-tag">extracted from this doc</span>}</span>
                        <span className="v">{r.tone ? <Pill tone={r.tone} dot>{r.v}</Pill> : r.v}</span>
                      </div>
                    )
                  })}
                </div>
                <p className="ir-source-snippet">{docBodyText(ext, sourceDoc.doc)}</p>
              </>
            )}
            {sourceDoc.doc.file && <p className="ir-source-file"><Icon name="documents" size={12} /> {sourceDoc.doc.file}</p>}
            <div className="ir-source-actions">
              <Button variant="ghost" size="sm" onClick={() => downloadDocFile(sourceDoc.doc)}><Icon name="download" size={13} /> Download</Button>
              <Button size="sm" onClick={() => viewDoc(sourceDoc.doc, sourceDoc.field)}><Icon name="external" size={13} /> View full document</Button>
            </div>
          </div>
          )
        })()}
      </Modal>

    </div>
  )
}

function DocRow({ doc, onView, onDownload, onUpload, onRemove }:
  { doc: RequiredDoc; onView: () => void; onDownload: () => void; onUpload?: (file: File) => void; onRemove?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])
  return (
    <div className={`ir-doc ${doc.received ? 'ok' : 'miss'}`}>
      <span className="ir-doc-dot">{doc.received ? '✓' : '!'}</span>
      <div className="ir-doc-body">
        <div className="ir-doc-name">{doc.name}</div>
        {doc.file && <div className="ir-doc-file">{doc.file}</div>}
      </div>
      {doc.received
        ? <div className="ir-doc-actions">
            <button className="btn ghost sm" onClick={onView}>View</button>
            {onUpload && (
              <>
                <button className="btn ghost sm" onClick={() => fileRef.current?.click()} title="Wrong file attached to this slot? Swap it out.">
                  <Icon name="upload" size={12} /> Replace
                </button>
                <input
                  ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }}
                />
              </>
            )}
            <div className="ir-doc-more" ref={menuRef}>
              <button className="ir-doc-dl" title="More" aria-label="More" onClick={() => setMenuOpen((v) => !v)}>⋯</button>
              {menuOpen && (
                <div className="ir-doc-menu" role="menu">
                  <button role="menuitem" onClick={() => { setMenuOpen(false); onDownload() }}>
                    <Icon name="download" size={13} /> Download
                  </button>
                  {onRemove && (
                    <button role="menuitem" className="danger" onClick={() => { setMenuOpen(false); if (window.confirm(`Remove "${doc.name}"?`)) onRemove() }}>
                      <Icon name="close" size={13} /> Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        : <div className="ir-doc-actions">
            <Pill tone="warn">Not yet attached</Pill>
            {onUpload && (
              <>
                <button className="btn ghost sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={12} /> Upload
                </button>
                <input
                  ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }}
                />
              </>
            )}
          </div>}
    </div>
  )
}

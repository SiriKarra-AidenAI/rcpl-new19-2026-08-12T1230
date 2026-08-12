import { useRef, useState } from 'react'
import { Button, Modal } from './ui'
import type { ApplicationSubtype, DisengagementForm, Partner } from '../types'

// Field-for-field reproduction of RCPL's real Disengagement sheet — the "next sheet" a
// Replacement DB's old distributor gets filled in against. Shared by Create Lead (fill it up
// front, inline, matching the workbook's own "If Replacement, fill up next sheet" instruction —
// see DisengagementFormFields) and Approvals (the Discontinuation Form gate, wrapped in a modal
// via DisengagementFormModal, as a fallback if it wasn't filled at intake time).

// Shared by both Create Lead and Intake Review's own subtype pickers, so an email-derived lead
// gets the exact same "New DB / Replacement / Additional" options as one entered by hand.
export const DB_SUBTYPES = ['New DB', 'Replacement DB', 'Additional DB'] as const
export const SUBTYPE_MAP: Record<typeof DB_SUBTYPES[number], ApplicationSubtype> = {
  'New DB': 'new', 'Replacement DB': 'replacement', 'Additional DB': 'additional',
}

export const TERMINATION_REASONS = [
  'Non-performance / sales decline', 'Financial irregularities', 'Breach of distribution agreement',
  'Loss of business interest', 'Relocation / business closure', 'Others (plz give details)',
]
export const DISTRIBUTOR_DESIRE_REASONS = [
  'Health / personal reasons', 'Business not profitable for them', 'Family business succession issues',
  'Relocating / winding up business', 'Others (plz give details)',
]
export const BLANK_DISC_FORM: DisengagementForm = {
  distributorNameAddressDbCode: '', dateOfAppointment: '', majorTownsCovered: '',
  handlesOtherCompanies: false, competingCompanies: ['', '', '', ''],
  salesHistory: { fy24: { avgSalesPerMonth: 0, growthPct: 0 }, fy25: { avgSalesPerMonth: 0, growthPct: 0 } },
  terminationReason: TERMINATION_REASONS[0], distributorDesireReason: DISTRIBUTOR_DESIRE_REASONS[0],
  stockValueLakh: 0, actionPlanned: {}, ndcSubmitted: false,
}

// Picking which DB is being replaced already tells us who they are and when they were
// appointed — the Partners directory is the actual source of truth for that, so it pre-fills
// everything the app already knows instead of making someone re-type it. Only the genuinely
// new-to-this-form fields (sales history, termination reason, stock value, NDC…) still need a
// human to fill in — there's no existing record of those anywhere in the app.
export function applyPartnerToDiscForm(f: DisengagementForm, p: Partner): DisengagementForm {
  return {
    ...f,
    distributorNameAddressDbCode: `${p.legalName}, ${p.town}, ${p.state}${p.dbCode ? ` — ${p.dbCode}` : ''}`,
    dateOfAppointment: p.onboardedAt ?? f.dateOfAppointment,
    majorTownsCovered: p.town,
  }
}

// Just the sheet's own fields — no Modal, no submit button — so a caller can render the whole
// form inline (Create Lead, right where "Replacement DB" is picked) as easily as in a popup.
export function DisengagementFormFields({ f, setF, readOnly }: {
  f: DisengagementForm; setF: (updater: (s: DisengagementForm) => DisengagementForm) => void; readOnly?: boolean
}) {
  const setCompany = (i: number, v: string) => setF((s) => {
    const competingCompanies = [...s.competingCompanies]
    competingCompanies[i] = v
    return { ...s, competingCompanies }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div className="field">
        <label>1. Name, Address &amp; DB Code of Distributor</label>
        <input className="input" disabled={readOnly} value={f.distributorNameAddressDbCode}
          onChange={(e) => setF((s) => ({ ...s, distributorNameAddressDbCode: e.target.value }))} />
      </div>
      <div className="field">
        <label>2. Date of Appointment</label>
        <input className="input" disabled={readOnly} value={f.dateOfAppointment} placeholder="e.g. 12/03/2019"
          onChange={(e) => setF((s) => ({ ...s, dateOfAppointment: e.target.value }))} />
      </div>
      <div className="field">
        <label>3. Major Towns Covered (including any major Upcountry town)</label>
        <input className="input" disabled={readOnly} value={f.majorTownsCovered}
          onChange={(e) => setF((s) => ({ ...s, majorTownsCovered: e.target.value }))} />
      </div>

      <div className="field">
        <label>4. Does he handle other companies' agency?</label>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {(['Yes', 'No'] as const).map((v) => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600, fontSize: '0.85rem' }}>
              <input type="radio" disabled={readOnly} checked={f.handlesOtherCompanies === (v === 'Yes')}
                onChange={() => setF((s) => ({ ...s, handlesOtherCompanies: v === 'Yes' }))} /> {v}
            </label>
          ))}
        </div>
      </div>
      {f.handlesOtherCompanies && (
        <div className="field">
          <label>4.a Name of the Company (competing products)</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {f.competingCompanies.map((v, i) => (
              <input key={i} className="input" disabled={readOnly} value={v} placeholder={`(${'i,ii,iii,iv'.split(',')[i]})`}
                onChange={(e) => setCompany(i, e.target.value)} />
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label>5. Sales History (Last 2 years) — Cum Performance for the Year</label>
        <div className="dtable-wrap">
          <table className="dtable">
            <thead><tr><th></th><th>Avg Sales / Month (₹L)</th><th>Growth (%)</th></tr></thead>
            <tbody>
              {(['fy24', 'fy25'] as const).map((yr) => (
                <tr key={yr}>
                  <td className="strong">{yr.toUpperCase()}</td>
                  <td><input className="input" type="number" disabled={readOnly} value={f.salesHistory[yr].avgSalesPerMonth}
                    onChange={(e) => setF((s) => ({ ...s, salesHistory: { ...s.salesHistory, [yr]: { ...s.salesHistory[yr], avgSalesPerMonth: +e.target.value } } }))} /></td>
                  <td><input className="input" type="number" disabled={readOnly} value={f.salesHistory[yr].growthPct}
                    onChange={(e) => setF((s) => ({ ...s, salesHistory: { ...s.salesHistory, [yr]: { ...s.salesHistory[yr], growthPct: +e.target.value } } }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="field">
        <label>6. If we are recommending Termination/Discontinuation, give reasons</label>
        <select className="select" disabled={readOnly} value={f.terminationReason}
          onChange={(e) => setF((s) => ({ ...s, terminationReason: e.target.value }))}>
          {TERMINATION_REASONS.map((r) => <option key={r}>{r}</option>)}
        </select>
        {f.terminationReason === 'Others (plz give details)' && (
          <input className="input" style={{ marginTop: '0.4rem' }} disabled={readOnly} value={f.terminationReasonOther ?? ''}
            placeholder="If Others, please specify" onChange={(e) => setF((s) => ({ ...s, terminationReasonOther: e.target.value }))} />
        )}
      </div>

      <div className="field">
        <label>7. If distributor has expressed his desire to discontinue his business relation with RCPL</label>
        <select className="select" disabled={readOnly} value={f.distributorDesireReason}
          onChange={(e) => setF((s) => ({ ...s, distributorDesireReason: e.target.value }))}>
          {DISTRIBUTOR_DESIRE_REASONS.map((r) => <option key={r}>{r}</option>)}
        </select>
        {f.distributorDesireReason === 'Others (plz give details)' && (
          <input className="input" style={{ marginTop: '0.4rem' }} disabled={readOnly} value={f.distributorDesireReasonOther ?? ''}
            placeholder="If Others, please specify" onChange={(e) => setF((s) => ({ ...s, distributorDesireReasonOther: e.target.value }))} />
        )}
      </div>

      <div className="field">
        <label>8. Stock value (₹L) as on date</label>
        <input className="input" type="number" disabled={readOnly} value={f.stockValueLakh}
          onChange={(e) => setF((s) => ({ ...s, stockValueLakh: +e.target.value }))} />
      </div>
      <div className="field">
        <label>Action planned (if any)</label>
        <div className="kv-grid">
          <div className="field"><label style={{ fontWeight: 400, fontSize: '0.76rem' }}>A. Transferred to New Distributor</label>
            <input className="input" disabled={readOnly} value={f.actionPlanned.transferredTo ?? ''}
              onChange={(e) => setF((s) => ({ ...s, actionPlanned: { ...s.actionPlanned, transferredTo: e.target.value } }))} /></div>
          <div className="field"><label style={{ fontWeight: 400, fontSize: '0.76rem' }}>B. Liquidated in the market</label>
            <input className="input" disabled={readOnly} value={f.actionPlanned.liquidatedInMarket ?? ''}
              onChange={(e) => setF((s) => ({ ...s, actionPlanned: { ...s.actionPlanned, liquidatedInMarket: e.target.value } }))} /></div>
          <div className="field"><label style={{ fontWeight: 400, fontSize: '0.76rem' }}>C. Others</label>
            <input className="input" disabled={readOnly} value={f.actionPlanned.others ?? ''}
              onChange={(e) => setF((s) => ({ ...s, actionPlanned: { ...s.actionPlanned, others: e.target.value } }))} /></div>
        </div>
      </div>

      <div className="field">
        <label>9. NDC submitted (Y/N)</label>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: f.ndcSubmitted ? '0.5rem' : 0 }}>
          {(['Yes', 'No'] as const).map((v) => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600, fontSize: '0.85rem' }}>
              <input type="radio" disabled={readOnly} checked={f.ndcSubmitted === (v === 'Yes')}
                onChange={() => setF((s) => ({ ...s, ndcSubmitted: v === 'Yes' }))} /> {v}
            </label>
          ))}
        </div>
        {f.ndcSubmitted && (
          <input className="input" disabled={readOnly} value={f.ndcSubmittedTillMonth ?? ''} placeholder="Till which month, e.g. May-25"
            onChange={(e) => setF((s) => ({ ...s, ndcSubmittedTillMonth: e.target.value }))} />
        )}
      </div>
    </div>
  )
}

// Modal wrapper around DisengagementFormFields, for contexts that need it as a popup rather than
// inline (Approvals' Discontinuation Form gate).
export function DisengagementFormModal({ open, onClose, existing, readOnly, title, submitLabel, onSubmit }: {
  open: boolean; onClose: () => void; existing?: DisengagementForm; readOnly?: boolean
  title?: string; submitLabel?: string
  onSubmit: (form: DisengagementForm) => void
}) {
  const [f, setF] = useState<DisengagementForm>(existing ?? BLANK_DISC_FORM)
  // Re-sync when a different case's existing form (or none) opens, or if it was just submitted.
  const openedFor = useRef<DisengagementForm | undefined>(existing)
  if (open && openedFor.current !== existing) { openedFor.current = existing; if (existing) setF(existing) }

  const canSubmit = !readOnly && f.distributorNameAddressDbCode.trim() && f.dateOfAppointment.trim()

  return (
    <Modal open={open} onClose={onClose} size="lg" title={title ?? 'Distributor Disengagement Recommendation Form'}>
      <DisengagementFormFields f={f} setF={setF} readOnly={readOnly} />
      <div className="row-between" style={{ marginTop: '0.85rem' }}>
        <Button variant="ghost" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && (
          <Button disabled={!canSubmit} onClick={() => onSubmit(f)}>{submitLabel ?? 'Submit Disengagement Form →'}</Button>
        )}
      </div>
    </Modal>
  )
}

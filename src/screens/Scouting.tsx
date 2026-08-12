import './Scouting.css'
import { useState } from 'react'
import { Button, Card, Modal, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { CaseTimeline } from '../components/CaseTimeline'
import { useApp } from '../store'
import { DEMO_USERS } from '../mock/roles'
import { memberName } from '../mock/team'
import { requiredTiers, MAX_ADVANCE } from '../mock/scouting'
import { STATE_ORDER, TRANSITIONS, stateLabel } from '../lib/caseEngine'
import { addWorkingDays, slaLabel, slaStateFor, SLA_TONE } from '../lib/workingDays'
import type { ScoutCandidate, ScoutingCase } from '../types'

const RETAILERS = ['SAMT', 'WS', 'KG']
const REASON_OPTIONS = ['New market opportunity', '30-day termination notice', 'Territory expansion', 'Underperforming DB replacement']

/** Embeddable scouting panel — rendered inside the Intake Inbox "Scouting" tab (no page chrome). */
export function ScoutingPanel() {
  const scoutingCases = useApp((s) => s.scoutingCases)
  const scoutingDays = useApp((s) => s.slaConfig.scoutingDays)
  const serveTerminationNotice = useApp((s) => s.serveTerminationNotice)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const actorName = DEMO_USERS[viewingAs]?.name ?? 'You'
  const [openId, setOpenId] = useState<string | null>(null)
  // The only way to open a scouting case used to be Partners' "Serve termination notice" button
  // (tied to discontinuing an existing DB) — this reuses the same store action (it never
  // actually required a partner) so a new market opportunity can be scouted from here directly.
  const [newOpen, setNewOpen] = useState(false)
  const blankNew = { area: '', state: 'Maharashtra', townClass: 'Up to FLP' as ScoutingCase['townClass'], reason: REASON_OPTIONS[0] }
  const [nsc, setNsc] = useState(blankNew)
  const startScouting = () => {
    if (!nsc.area.trim() || !nsc.state.trim()) return
    const id = serveTerminationNotice({ area: nsc.area.trim(), state: nsc.state.trim(), townClass: nsc.townClass, reason: nsc.reason }, actorName)
    setNewOpen(false)
    setNsc(blankNew)
    setOpenId(id)
  }

  const open = openId ? scoutingCases.find((c) => c.id === openId) : null
  if (open) return <ScoutingDetail sc={open} onBack={() => setOpenId(null)} viewingAs={viewingAs} />

  return (
    <div>
      <div className="row-between" style={{ alignItems: 'flex-start', gap: '0.8rem', marginBottom: '1rem' }}>
        <p className="page-sub" style={{ margin: 0 }}>
          A scouting case opens when a 30-day termination notice lands (Day D), or when you start one for a new market
          opportunity. Shortlist → retailer feedback → interest → hand off max {MAX_ADVANCE} to the appointment stage, within 7 working days.
        </p>
        <Button size="sm" onClick={() => setNewOpen(true)} style={{ flex: 'none' }}><Icon name="plus" size={13} /> New scouting case</Button>
      </div>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Start a new scouting case">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="field">
            <label>Area / Town</label>
            <input className="input" value={nsc.area} onChange={(e) => setNsc((v) => ({ ...v, area: e.target.value }))} placeholder="e.g. Aurangabad" />
          </div>
          <div className="field">
            <label>State</label>
            <input className="input" value={nsc.state} onChange={(e) => setNsc((v) => ({ ...v, state: e.target.value }))} />
          </div>
          <div className="field">
            <label>Town classification</label>
            <select className="input" value={nsc.townClass} onChange={(e) => setNsc((v) => ({ ...v, townClass: e.target.value as ScoutingCase['townClass'] }))}>
              <option>Up to FLP</option>
              <option>Below FLP</option>
            </select>
          </div>
          <div className="field">
            <label>Reason</label>
            <select className="input" value={nsc.reason} onChange={(e) => setNsc((v) => ({ ...v, reason: e.target.value }))}>
              {REASON_OPTIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="row-between" style={{ marginTop: '0.4rem' }}>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button disabled={!nsc.area.trim() || !nsc.state.trim()} onClick={startScouting}>Start scouting →</Button>
          </div>
        </div>
      </Modal>

      <div className="sc-grid">
        {scoutingCases.length === 0 && (
          <p className="muted-note">No scouting cases yet — click "New scouting case" above to open one.</p>
        )}
        {scoutingCases.map((c) => {
          const due = addWorkingDays(c.dayD, scoutingDays)
          const sla = slaStateFor(due)
          const advanced = c.candidates.filter((x) => x.advanced).length
          return (
            <button className="sc-card" key={c.id} onClick={() => setOpenId(c.id)}>
              <div className="sc-card-top">
                <span className="sc-code">{c.code}</span>
                <Pill tone={c.caseState === 'HANDED_OFF' ? 'good' : c.caseState === 'CANCELLED' ? 'crit' : 'ai'} dot>{stateLabel(c.caseState)}</Pill>
              </div>
              <div className="sc-area">{c.area}, {c.state}</div>
              <div className="sc-meta">{c.reason} · {c.townClass}</div>
              <div className="sc-foot">
                <span>{c.candidates.length} candidate{c.candidates.length === 1 ? '' : 's'}{advanced ? ` · ${advanced} advancing` : ''}</span>
                {c.caseState !== 'HANDED_OFF' && c.caseState !== 'CANCELLED'
                  ? <Pill tone={SLA_TONE[sla]}>{slaLabel(due)}</Pill>
                  : <span className="sc-owner">{memberName(c.assigneeId)}</span>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ScoutingDetail({ sc, onBack, viewingAs }: { sc: ScoutingCase; onBack: () => void; viewingAs: import('../types').RoleCode }) {
  const advanceScouting = useApp((s) => s.advanceScouting)
  const updateScoutCandidate = useApp((s) => s.updateScoutCandidate)
  const handOffScouting = useApp((s) => s.handOffScouting)
  const addScoutCandidate = useApp((s) => s.addScoutCandidate)
  const scoutingDays = useApp((s) => s.slaConfig.scoutingDays)
  const due = addWorkingDays(sc.dayD, scoutingDays)
  const actorName = DEMO_USERS[viewingAs]?.name ?? 'You'
  const [handoffMsg, setHandoffMsg] = useState<string | null>(null)
  const [nc, setNc] = useState<{ name: string; town: string; tier: ScoutCandidate['companyTier']; competing: boolean }>({ name: '', town: sc.area, tier: 'Tier 1', competing: false })

  const ladder = STATE_ORDER.scouting
  const current = sc.caseState
  const currentIdx = ladder.indexOf(current)
  const nextStates = (TRANSITIONS.scouting[current] ?? []).filter((s) => s !== 'HANDED_OFF')
  const allowedTiers = requiredTiers(sc.townClass)
  const advancedCount = sc.candidates.filter((c) => c.advanced).length
  const offPath = current === 'CANCELLED'
  const done = current === 'HANDED_OFF' || offPath
  const sla = slaStateFor(due)

  const addFeedback = (candId: string, existing: ScoutingCase['candidates'][number]['retailerFeedback']) => {
    if (existing.length >= 3) return
    const retailer = RETAILERS[existing.length]
    updateScoutCandidate(sc.id, candId, { retailerFeedback: [...existing, { retailer, service: 4, credit: 4 }] })
  }

  return (
    <div>
      <div className="page-head">
        <button className="sc-back" onClick={onBack}><Icon name="back" size={14} /> All scouting</button>
        <h1>{sc.code} — {sc.area}</h1>
        <p className="page-sub">{sc.reason} · {sc.townClass} (needs {allowedTiers.join(' / ')}) · SLA <b>{slaLabel(due)}</b></p>
      </div>

      <Card title="Scouting workflow">
        <div className="sct-stepper">
          {ladder.map((st, i) => (
            <div key={st} className={`sct-step ${i < currentIdx ? 'done' : ''} ${st === current ? 'now' : ''}`}>
              <span className="sct-step-dot">{i < currentIdx ? <Icon name="check" size={11} /> : i + 1}</span>
              <span className="sct-step-lbl">{stateLabel(st)}</span>
            </div>
          ))}
          {offPath && <div className="sct-step now off"><span className="sct-step-dot"><Icon name="close" size={11} /></span><span className="sct-step-lbl">Cancelled</span></div>}
        </div>
        <div className="sc-actions">
          <span>Current: <b>{stateLabel(current)}</b> · <Pill tone={SLA_TONE[sla]} dot>{slaLabel(due)}</Pill></span>
          <div className="sc-actions-btns">
            {!done && nextStates.map((to) => (
              <Button key={to} variant={to === 'CANCELLED' ? 'ghost' : 'primary'} size="sm"
                onClick={() => advanceScouting(sc.id, to, actorName)}>
                {to === 'CANCELLED' ? <Icon name="close" size={13} /> : <Icon name="chevronRight" size={13} />} {stateLabel(to)}
              </Button>
            ))}
            {current === 'INTEREST_CHECK' && (
              <Button size="sm" disabled={advancedCount === 0}
                onClick={() => { const n = handOffScouting(sc.id, actorName); setHandoffMsg(n ? `Handed off ${n} candidate${n > 1 ? 's' : ''} to the appointment stage — see Leads.` : null) }}>
                <Icon name="approvals" size={13} /> Hand off {advancedCount || ''} to appointment
              </Button>
            )}
          </div>
        </div>
        {handoffMsg && <div className="cw-esc-msg"><Icon name="check" size={13} /> {handoffMsg}</div>}
      </Card>

      <Card title={`Candidates (${sc.candidates.length}) — max ${MAX_ADVANCE} advance`} className="sc-cand-card">
        <div className="dtable-wrap">
          <table className="dtable sc-table">
            <thead><tr><th>Candidate</th><th>Tier</th><th>Competing brand</th><th>Retailer feedback</th><th>Interested</th><th>Advance</th></tr></thead>
            <tbody>
              {sc.candidates.map((c) => {
                const tierOk = allowedTiers.includes(c.companyTier)
                const excluded = c.competingBrand && !c.competingBrandOverride
                return (
                  <tr key={c.id} className={excluded ? 'sc-excluded' : ''}>
                    <td className="strong">{c.name}<div className="cell-sub">{c.town}</div></td>
                    <td><Pill tone={tierOk ? 'good' : 'warn'}>{c.companyTier}</Pill></td>
                    <td>
                      {c.competingBrand
                        ? <label className="sc-inline"><input type="checkbox" checked={!!c.competingBrandOverride} disabled={done}
                            onChange={(e) => updateScoutCandidate(sc.id, c.id, { competingBrandOverride: e.target.checked })} /> {c.competingBrandOverride ? 'Overridden' : 'Yes — exclude'}</label>
                        : <span className="muted-note" style={{ margin: 0 }}>None</span>}
                    </td>
                    <td>
                      <div className="sc-fb">
                        {c.retailerFeedback.map((f) => <Pill key={f.retailer} tone="neutral">{f.retailer} S{f.service}/C{f.credit}</Pill>)}
                        {!done && c.retailerFeedback.length < 3 && (
                          <button className="sc-fb-add" onClick={() => addFeedback(c.id, c.retailerFeedback)}>+ retailer</button>
                        )}
                      </div>
                    </td>
                    <td>
                      <label className="sc-inline"><input type="checkbox" checked={!!c.interested} disabled={done}
                        onChange={(e) => updateScoutCandidate(sc.id, c.id, { interested: e.target.checked })} /> {c.interested ? 'Yes' : '—'}</label>
                    </td>
                    <td>
                      <input type="checkbox" checked={!!c.advanced} disabled={done || excluded || (!c.advanced && advancedCount >= MAX_ADVANCE)}
                        onChange={(e) => updateScoutCandidate(sc.id, c.id, { advanced: e.target.checked })}
                        title={excluded ? 'Competing-brand DB — exclude or override first' : advancedCount >= MAX_ADVANCE && !c.advanced ? `Max ${MAX_ADVANCE} candidates` : 'Advance to appointment'} />
                    </td>
                  </tr>
                )
              })}
              {sc.candidates.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: '1rem 0' }}>No candidates yet — add prospects from your market list below.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {!done && (
          <div className="sc-add">
            <input placeholder="Candidate firm name" value={nc.name} onChange={(e) => setNc((v) => ({ ...v, name: e.target.value }))} />
            <input placeholder="Town" value={nc.town} onChange={(e) => setNc((v) => ({ ...v, town: e.target.value }))} />
            <select value={nc.tier} onChange={(e) => setNc((v) => ({ ...v, tier: e.target.value as ScoutCandidate['companyTier'] }))}>
              <option>Tier 1</option><option>Tier 2</option><option>Tier 3</option>
            </select>
            <label className="sc-inline"><input type="checkbox" checked={nc.competing} onChange={(e) => setNc((v) => ({ ...v, competing: e.target.checked }))} /> Competing brand</label>
            <Button size="sm" disabled={!nc.name.trim()}
              onClick={() => { addScoutCandidate(sc.id, { name: nc.name.trim(), town: nc.town.trim() || sc.area, companyTier: nc.tier, competingBrand: nc.competing }); setNc({ name: '', town: sc.area, tier: 'Tier 1', competing: false }) }}>
              <Icon name="plus" size={13} /> Add candidate
            </Button>
          </div>
        )}
      </Card>

      <Card title="Timeline"><CaseTimeline events={sc.events} empty="No scouting activity yet." /></Card>
    </div>
  )
}

import './Scouting.css'
import './OnboardingCases.css'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { CaseTimeline } from '../components/CaseTimeline'
import { useApp } from '../store'
import { DEMO_USERS } from '../mock/roles'
import { memberName } from '../mock/team'
import { partnerTypeLabel } from '../mock/templates'
import { ONBOARDING_STAGE_DAYS, ONBOARDING_STAGE_OWNER } from '../mock/onboardingCases'
import { STATE_ORDER, stateLabel } from '../lib/caseEngine'
import type { OnboardingCase } from '../types'

/** The onboarding queue grid — list only. Approvals owns which case (if any) is open and, when
 *  one is, renders OnboardingDetail INSTEAD of this + the appointment queue, the same way an
 *  opened appointment case replaces the whole page rather than stacking below the empty queue
 *  banner. */
export function OnboardingPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const onboardingCases = useApp((s) => s.onboardingCases)
  const partners = useApp((s) => s.partners)

  return (
    <div>
      <p className="page-sub" style={{ marginBottom: '1rem' }}>
        Every activated DB gets an onboarding case: Appointment (IT creates the DB Code, D+2) → Complete — it then sits in Partners.
      </p>
      <div className="sc-grid">
        {onboardingCases.map((c) => {
          const idx = STATE_ORDER.onboarding.indexOf(c.caseState)
          const partner = c.partnerId ? partners.find((p) => p.id === c.partnerId) : undefined
          const awaitingDbCode = c.caseState === 'APPOINTMENT' && !partner?.dbCode
          return (
            <button className="sc-card" key={c.id} onClick={() => onOpen(c.id)}>
              <div className="sc-card-top">
                <span className="sc-code">{partner?.dbCode ?? c.code}</span>
                <Pill tone={c.caseState === 'COMPLETE' ? 'good' : awaitingDbCode ? 'warn' : 'ai'} dot>
                  {awaitingDbCode ? 'Awaiting DB Code' : stateLabel(c.caseState)}
                </Pill>
              </div>
              <div className="sc-area">{c.partnerName}</div>
              <div className="sc-meta">{c.town}, {c.state}{c.parentCaseCode ? ` · from ${c.parentCaseCode}` : ''}</div>
              <div className="sc-foot">
                <span>Stage {Math.max(1, idx + 1)} of {STATE_ORDER.onboarding.length}</span>
                <span className="sc-owner">{memberName(c.assigneeId)}</span>
              </div>
            </button>
          )
        })}
        {onboardingCases.length === 0 && <Card><p style={{ padding: '0.5rem 0' }}>No onboarding cases yet — they open automatically when a DB is activated.</p></Card>}
      </div>
    </div>
  )
}

type ObTab = 'timeline' | 'documents' | 'comments' | 'activities'
const OB_TABS: { key: ObTab; label: string }[] = [
  { key: 'timeline', label: 'Timeline' }, { key: 'documents', label: 'Documents' },
  { key: 'comments', label: 'Comments' }, { key: 'activities', label: 'Activities' },
]

export function OnboardingDetail({ ob, onBack, viewingAs }: { ob: OnboardingCase; onBack: () => void; viewingAs: import('../types').RoleCode }) {
  const createDbCode = useApp((s) => s.createDbCode)
  const partners = useApp((s) => s.partners)
  const navigate = useNavigate()
  const actorName = DEMO_USERS[viewingAs]?.name ?? 'You'
  const ladder = STATE_ORDER.onboarding
  const current = ob.caseState
  const currentIdx = ladder.indexOf(current)
  const done = current === 'COMPLETE'
  const [tab, setTab] = useState<ObTab>('timeline')

  // Creating the DB Code is the only step — it takes the case straight to Complete, no separate
  // advance click needed.
  const partner = ob.partnerId ? partners.find((p) => p.id === ob.partnerId) : undefined
  const dbCode = partner?.dbCode
  const awaitingDbCode = current === 'APPOINTMENT' && !dbCode
  const canCreateDbCode = viewingAs === 'it' || viewingAs === 'admin'
  const totalDays = Object.values(ONBOARDING_STAGE_DAYS).reduce((a, b) => a + b, 0)
  const createdEvent = [...ob.events].sort((a, b) => a.at - b.at)[0]
  const lastEvent = [...ob.events].sort((a, b) => b.at - a.at)[0]

  return (
    <div>
      <button className="sc-back" onClick={onBack}><Icon name="back" size={14} /> All onboarding</button>

      <div className="obd-head">
        <span className="obd-avatar"><Icon name="partners" size={20} /></span>
        <div className="obd-head-text">
          <h1>{dbCode ?? ob.code} — {ob.partnerName}</h1>
          <p className="page-sub">{ob.code} · {ob.town}, {ob.state} · Owner: {memberName(ob.assigneeId)}</p>
        </div>
        <Pill tone={done ? 'good' : awaitingDbCode ? 'warn' : 'ai'} dot>{done ? 'Onboarding complete' : stateLabel(current)}</Pill>
      </div>

      <div className="obd-layout">
        <div className="obd-main">
          <Card title="Onboarding stages">
            <div className="cw-stepper">
              {ladder.map((st, i) => (
                <div key={st} className={`cw-step ${i < currentIdx ? 'done' : ''} ${st === current ? 'now' : ''}`}>
                  <span className="cw-step-dot">{i < currentIdx ? <Icon name="check" size={11} /> : i + 1}</span>
                  <span className="cw-step-lbl">{stateLabel(st)}{ONBOARDING_STAGE_DAYS[st] ? ` · ${ONBOARDING_STAGE_DAYS[st]}d` : ''}</span>
                </div>
              ))}
            </div>
            <div className={`obd-banner ${done ? 'good' : ''}`}>
              <span>Current: <b>{stateLabel(current)}</b> · owner {ONBOARDING_STAGE_OWNER[current]}</span>
              <div className="obd-banner-pills">
                {dbCode && <Pill tone="good">DB Code {dbCode}</Pill>}
                {done && <Pill tone="good">Total duration: {totalDays} days</Pill>}
                {awaitingDbCode && (
                  <Button
                    size="sm"
                    disabled={!canCreateDbCode}
                    title={!canCreateDbCode ? 'Only IT can create the DB Code' : undefined}
                    onClick={() => createDbCode(ob.id, actorName)}
                  >
                    <Icon name="monitor" size={13} /> Create DB Code
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <Card title="Summary">
            <div className="obd-summary">
              <div className="obd-sum-tile"><Icon name="documents" size={15} /><div><div className="k">Case type</div><div className="v">{partner ? partnerTypeLabel(partner.partnerType).split(' ')[0] : '—'}</div></div></div>
              <div className="obd-sum-tile"><Icon name="target" size={15} /><div><div className="k">Location</div><div className="v">{ob.town}, {ob.state}</div></div></div>
              <div className="obd-sum-tile"><Icon name="user" size={15} /><div><div className="k">Assigned to</div><div className="v">{memberName(ob.assigneeId)}</div></div></div>
              <div className="obd-sum-tile"><Icon name="calendar" size={15} /><div><div className="k">Created on</div><div className="v">{createdEvent?.when ?? '—'}</div></div></div>
              <div className="obd-sum-tile"><Icon name="clock" size={15} /><div><div className="k">Last updated</div><div className="v">{lastEvent?.when ?? '—'}</div></div></div>
            </div>
          </Card>

          <Card>
            <div className="obd-tabs">
              {OB_TABS.map((t) => (
                <button key={t.key} className={`obd-tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
              ))}
            </div>
            {tab === 'timeline' && <CaseTimeline events={ob.events} empty="No onboarding activity yet." />}
            {tab === 'documents' && <div className="ctl-empty">No documents on this onboarding case.</div>}
            {tab === 'comments' && <div className="ctl-empty">No comments yet.</div>}
            {tab === 'activities' && <CaseTimeline events={ob.events} empty="No activity yet." />}
          </Card>
        </div>

        <div className="obd-side">
          <Card title="Case information">
            <div className="obd-ci">
              <div className="obd-ci-row"><span>Case ID</span><b>{ob.code}</b></div>
              <div className="obd-ci-row"><span>Partner</span><b>{ob.partnerName}</b></div>
              <div className="obd-ci-row"><span>DB Code</span>{dbCode ? <Pill tone="good">{dbCode}</Pill> : <span className="muted-note" style={{ margin: 0 }}>Pending</span>}</div>
              {partner && <div className="obd-ci-row"><span>Partner type</span><b>{partnerTypeLabel(partner.partnerType).split(' ')[0]}</b></div>}
              <div className="obd-ci-row"><span>Town / City</span><b>{ob.town}</b></div>
              <div className="obd-ci-row"><span>State</span><b>{ob.state}</b></div>
              <div className="obd-ci-row"><span>Owner</span><b>{memberName(ob.assigneeId)}</b></div>
              <div className="obd-ci-row"><span>Assignee</span><b>{memberName(ob.assigneeId)}</b></div>
            </div>
            {partner && (
              <Button variant="ghost" size="sm" style={{ marginTop: '0.8rem' }} onClick={() => navigate('/partners')}>
                <Icon name="external" size={13} /> View in Partners
              </Button>
            )}
          </Card>

          {done && (
            <div className="obd-done-card">
              <Icon name="check" size={16} />
              <div>
                <div className="obd-done-t">Onboarding completed</div>
                <div className="obd-done-s">All required steps are finished.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

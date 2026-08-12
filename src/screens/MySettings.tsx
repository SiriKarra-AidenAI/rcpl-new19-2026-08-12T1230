import './MySettings.css'
import { useState } from 'react'
import { Button, Pill, Toggle } from '../components/ui'
import { Icon } from '../components/ui/icons'
import type { IconName } from '../components/ui/icons'
import { useApp, slaLabelFromHours } from '../store'
import { ROLE_BY_CODE, DEMO_USERS } from '../mock/roles'
import { TEAM_BY_ID, memberName } from '../mock/team'
import { effectiveAvailability, eligibleMembers, isUserAvailable } from '../lib/assignment'

const PROVIDERS: { id: 'gmail' | 'outlook'; label: string; color: string; domain: string; blurb: string }[] = [
  { id: 'gmail', label: 'Gmail', color: '#EA4335', domain: 'gmail.com',
    blurb: 'Connect your Gmail account to let the Intake Agent monitor and draft candidate profiles.' },
  { id: 'outlook', label: 'Outlook', color: '#0A63C2', domain: 'outlook.com',
    blurb: 'Connect your Outlook mailbox so the Intake Agent can watch and draft from it.' },
]

const SECTIONS: { id: string; label: string; ic: IconName }[] = [
  { id: 'availability', label: 'Availability', ic: 'calendar' },
  { id: 'inbox', label: 'Inbox Integration', ic: 'mail' },
  { id: 'agent', label: 'AI Agent Settings', ic: 'robot' },
  { id: 'sla', label: 'SLA Timer', ic: 'clock' },
  { id: 'automation', label: 'Automation', ic: 'bolt' },
  { id: 'notifications', label: 'Notifications', ic: 'bell' },
  { id: 'security', label: 'Security', ic: 'shield' },
  { id: 'account', label: 'Account', ic: 'user' },
  { id: 'activity', label: 'Activity Log', ic: 'list' },
]
// SLA windows an ASE/ASM can pick between — this drives how long a newly flagged/routed
// case gets before Dashboard/Approvals count it overdue.
const SLA_PRESETS = [4, 8, 24, 48, 72]

const initials = (name: string) => name.split(/[\s.]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

export function MySettings() {
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const inboxProvider = useApp((s) => s.inboxProvider)
  const inboxAddress = useApp((s) => s.inboxAddress)
  const connectInbox = useApp((s) => s.connectInbox)
  const disconnectInbox = useApp((s) => s.disconnectInbox)
  const autoForwardUnmatched = useApp((s) => s.autoForwardUnmatched)
  const setAutoForwardUnmatched = useApp((s) => s.setAutoForwardUnmatched)
  const slaHours = useApp((s) => s.slaHours)
  const setSlaHours = useApp((s) => s.setSlaHours)
  const availabilityByUser = useApp((s) => s.availabilityByUser)
  const setAvailability = useApp((s) => s.setAvailability)
  const flaggedCases = useApp((s) => s.flaggedCases)

  const role = ROLE_BY_CODE[viewingAs]
  const user = DEMO_USERS[viewingAs]
  const myAvail = effectiveAvailability(user.id, availabilityByUser)
  const meOnDuty = isUserAvailable(user.id, availabilityByUser)
  const myOpenCases = flaggedCases.filter((c) => c.assigneeId === user.id && c.status !== 'approved' && c.status !== 'rejected')
  const backupChoices = eligibleMembers(user.roleCode, user.state).filter((m) => m.id !== user.id)
  const isAseAsm = viewingAs === 'ase_asm'
  const sections = SECTIONS.filter((s) => s.id !== 'sla' || isAseAsm)

  // AI-agent behaviour is presentation-only for the prototype — kept in local state.
  const [active, setActive] = useState('inbox')
  const [confidence, setConfidence] = useState(85)
  const [draftReplies, setDraftReplies] = useState(true)
  const [escalate, setEscalate] = useState(true)

  const connectedLabel = inboxProvider ? PROVIDERS.find((p) => p.id === inboxProvider)?.label : null

  const go = (id: string) => {
    setActive(id)
    document.getElementById(`ms-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="ms">
      <div className="ms-head">
        <div className="ms-title">
          <span className="ms-gear"><Icon name="settings" size={22} /></span>
          <div>
            <h1>My Settings</h1>
            <p>Manage your personal preferences and AI agent configuration.</p>
          </div>
        </div>
        <div className="ms-hero" aria-hidden>
          <div className="ms-hero-panel">
            <span className="l w1" /><span className="l w2" /><span className="l w3" />
          </div>
          <span className="ms-hero-gear"><Icon name="settings" size={30} /></span>
        </div>
      </div>

      {/* Profile / status strip */}
      <div className="ms-profile card">
        <div className="ms-stat ms-stat--profile">
          <span className="ms-avatar" style={{ background: `var(${role.colorVar})` }}>{initials(user.name)}</span>
          <div className="ms-stat-body">
            <b>{user.name === 'R. Malhotra' ? 'Rahul Malhotra' : user.name}</b>
            <span>{role.label}</span>
            <button className="ms-edit" onClick={() => go('account')}>Edit Profile</button>
          </div>
        </div>
        <StatChip tile="good" ic="mail"
          title={connectedLabel ? `${connectedLabel} Connected` : 'No inbox connected'}
          sub={inboxAddress || 'Connect a mailbox below'} />
        <StatChip tile="good" ic="robot" title="AI Intake Agent" sub="Drafting & analyzing emails"
          pill={<Pill tone="good" dot>Active</Pill>} />
        <StatChip tile="ai" ic="send" title="Auto Forward" sub="Unmatched candidates"
          pill={<Pill tone={autoForwardUnmatched ? 'good' : 'neutral'}>{autoForwardUnmatched ? 'Enabled' : 'Off'}</Pill>} />
      </div>

      {/* Body: section rail + panels */}
      <div className="ms-body">
        <aside className="ms-rail">
          <nav>
            {sections.map((s) => (
              <button key={s.id} className={`ms-navitem ${active === s.id ? 'active' : ''}`} onClick={() => go(s.id)}>
                <span className="ic"><Icon name={s.ic} size={17} /></span>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="ms-help">
            <span className="ms-help-ic"><Icon name="help" size={18} /></span>
            <div>
              <b>Need help?</b>
              <span>Learn more about settings</span>
              <a href="#" onClick={(e) => e.preventDefault()}>View Docs <Icon name="external" size={12} /></a>
            </div>
          </div>
        </aside>

        <div className="ms-panels">
          {/* Availability — self-service leave / on-duty. Delegating cases is a supervisor action,
              so ASEs can flag themselves away but don't choose who covers (their RBL/ASM decides). */}
          <section id="ms-availability" className="card ms-panel">
            <PanelHead title="Availability" sub={isAseAsm
              ? 'Set yourself on leave so new work stops routing to you. Reassigning your open cases is your supervisor’s call — delegation isn’t self-service.'
              : 'Set yourself on leave and your work is handed to your backup (or the next on-duty peer) automatically.'} />
            <div className="ms-avail-row">
              <div>
                <div className="ms-avail-status">
                  <Pill tone={meOnDuty ? 'good' : 'warn'} dot>{meOnDuty ? 'On duty' : 'On leave'}</Pill>
                  <span className="ms-avail-load">{myOpenCases.length} open case{myOpenCases.length === 1 ? '' : 's'} assigned to you</span>
                </div>
                <p className="ms-avail-hint">
                  {meOnDuty
                    ? (isAseAsm
                        ? 'Turn this off before you go on leave — your supervisor is then notified to reassign your open cases.'
                        : 'Turn this off before you go on leave — any open cases assigned to you will move to your chosen backup.')
                    : (isAseAsm
                        ? 'You’re on leave — new work stops routing to you and your supervisor reassigns your open cases.'
                        : `You're on leave${myAvail.backupUserId ? ` — new work routes to ${memberName(myAvail.backupUserId)}` : ' — new work routes to the next available peer'}.`)}
                </p>
              </div>
              <Toggle on={meOnDuty} label={meOnDuty ? 'Available' : 'Away'}
                onChange={(on) => setAvailability(user.id, { ...myAvail, status: on ? 'on_duty' : 'on_leave' }, user.name)} />
            </div>
            {!meOnDuty && (isAseAsm ? (
              <div className="ms-avail-backup ms-avail-superv">
                <Icon name="info" size={14} />
                <span>Your open cases stay flagged for your <b>supervisor</b> to reassign — you can’t delegate them yourself.</span>
              </div>
            ) : (
              <div className="ms-avail-backup">
                <label>Delegate my cases to</label>
                <select value={myAvail.backupUserId ?? ''}
                  onChange={(e) => setAvailability(user.id, { ...myAvail, status: 'on_leave', backupUserId: e.target.value || undefined }, user.name)}>
                  <option value="">Auto — next on-duty peer</option>
                  {backupChoices.map((b) => (
                    <option key={b.id} value={b.id} disabled={!isUserAvailable(b.id, availabilityByUser)}>
                      {b.name} ({b.level}){!isUserAvailable(b.id, availabilityByUser) ? ' — on leave' : ''}
                    </option>
                  ))}
                </select>
                {myAvail.backupUserId && TEAM_BY_ID[myAvail.backupUserId] && (
                  <span className="ms-avail-deleg">Covering for you: <b>{memberName(myAvail.backupUserId)}</b></span>
                )}
              </div>
            ))}
          </section>

          {/* Inbox Integration */}
          <section id="ms-inbox" className="card ms-panel">
            <PanelHead title="Inbox Integration" sub="Connect and manage your email accounts used by the Intake Agent." />
            <div className="provider-grid">
              {PROVIDERS.map((p) => {
                const connected = inboxProvider === p.id
                return (
                  <div key={p.id} className={`provider-card ${connected ? 'connected' : ''}`}>
                    <div className="provider-head">
                      <span className="provider-mark" style={{ background: p.color }}>{p.label[0]}</span>
                      <div className="provider-headtext">
                        <div className="provider-name">{p.label}</div>
                        {connected
                          ? <Pill tone="good" dot>Connected</Pill>
                          : <span className="provider-off">Not connected</span>}
                      </div>
                      {connected && <Pill tone="good">Primary</Pill>}
                    </div>
                    {connected ? (
                      <>
                        <div className="provider-address">{inboxAddress}</div>
                        <div className="provider-used">Used by AI Intake Agent</div>
                        <Button variant="ghost" size="sm" onClick={disconnectInbox}>Disconnect</Button>
                      </>
                    ) : (
                      <>
                        <p className="provider-blurb">{p.blurb}</p>
                        <Button variant="ghost" size="sm" onClick={() => connectInbox(p.id, `r.malhotra@${p.domain}`)}>
                          Connect {p.label} <Icon name="external" size={13} />
                        </Button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="ms-toggle-row">
              <div>
                <div className="ms-toggle-title">Auto-forward unmatched candidates to me</div>
                <div className="ms-toggle-sub">You will receive a copy of anything the agent can’t confidently match.</div>
              </div>
              <Toggle on={autoForwardUnmatched} onChange={setAutoForwardUnmatched}
                label={<span className="ms-toggle-state">{autoForwardUnmatched ? 'Enabled' : 'Off'}</span>} />
            </div>
          </section>

          {/* AI Agent Settings */}
          <section id="ms-agent" className="card ms-panel">
            <PanelHead ic="robot" title="AI Agent Settings" sub="Configure how the AI Intake Agent works for you." />
            <div className="ms-agent-grid">
              <div className="ms-agent-cell">
                <div className="ms-toggle-title">Confidence threshold</div>
                <div className="ms-toggle-sub">Minimum confidence score for auto actions</div>
                <div className="ms-slider">
                  <input type="range" min={50} max={100} value={confidence}
                    onChange={(e) => setConfidence(Number(e.target.value))} aria-label="Confidence threshold" />
                  <span className="ms-slider-val tnum">{confidence}%</span>
                </div>
                <div className="ms-slider-scale"><span>50%</span><span>100%</span></div>
              </div>
              <div className="ms-agent-cell">
                <div className="ms-toggle-title">Draft replies automatically</div>
                <div className="ms-toggle-sub">Allow agent to draft email responses</div>
                <Toggle on={draftReplies} onChange={setDraftReplies}
                  label={<span className="ms-toggle-state">{draftReplies ? 'Enabled' : 'Off'}</span>} />
              </div>
              <div className="ms-agent-cell">
                <div className="ms-toggle-title">Escalate low confidence cases</div>
                <div className="ms-toggle-sub">Send low confidence cases for review</div>
                <Toggle on={escalate} onChange={setEscalate}
                  label={<span className="ms-toggle-state">{escalate ? 'Enabled' : 'Off'}</span>} />
              </div>
            </div>
          </section>

          {/* SLA Timer — ASE/ASM only: how long a case gets before it counts as overdue */}
          {isAseAsm && (
            <section id="ms-sla" className="card ms-panel">
              <PanelHead ic="clock" title="SLA Timer" sub="How long a newly flagged or routed case gets before it counts as overdue on Dashboard and Approvals." />
              <div className="ms-agent-cell">
                <div className="ms-toggle-title">Review window</div>
                <div className="ms-toggle-sub">Applies to new cases you raise going forward — cases already in the queue keep their existing SLA.</div>
                <div className="ms-sla-presets" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.6rem 0' }}>
                  {SLA_PRESETS.map((h) => (
                    <button key={h} className={`btn ${slaHours === h ? '' : 'ghost'} sm`} onClick={() => setSlaHours(h)}>
                      {slaLabelFromHours(h).replace(' left', '')}
                    </button>
                  ))}
                </div>
                <label className="ms-field" style={{ maxWidth: 220 }}>
                  <span>Custom (hours)</span>
                  <input className="input" type="number" min={1} max={168} value={slaHours}
                    onChange={(e) => setSlaHours(Math.max(1, Math.min(168, Number(e.target.value) || 1)))} />
                </label>
                <p className="muted-note" style={{ marginTop: '0.5rem' }}>
                  Current setting: <b>{slaLabelFromHours(slaHours)}</b> per new case.
                </p>
              </div>
            </section>
          )}

          {/* Remaining sections — lighter but real content */}
          <section id="ms-automation" className="card ms-panel">
            <PanelHead ic="bolt" title="Automation" sub="Rules that run without you lifting a finger." />
            <SimpleToggle title="Auto-clear clean applications" sub="Skip manual review when every check passes." def />
            <SimpleToggle title="Nudge stalled cases" sub="Ping owners when a case sits idle for 48 hours." def />
            <SimpleToggle title="Weekly digest" sub="Email me a summary of pipeline activity every Monday." />
          </section>

          <section id="ms-notifications" className="card ms-panel">
            <PanelHead ic="bell" title="Notifications" sub="Choose what reaches you and where." />
            <SimpleToggle title="New intake in my inbox" sub="When the agent files a new candidate." def />
            <SimpleToggle title="Approvals waiting on me" sub="When a case needs my sign-off." def />
            <SimpleToggle title="Flagged financial checks" sub="When a candidate trips a finance gate." def />
          </section>

          <section id="ms-security" className="card ms-panel">
            <PanelHead ic="shield" title="Security" sub="Keep your account protected." />
            <SimpleToggle title="Two-factor authentication" sub="Require a second factor at sign-in." def />
            <SimpleToggle title="Sign-in alerts" sub="Notify me of logins from a new device." def />
            <div className="ms-toggle-row">
              <div>
                <div className="ms-toggle-title">Active sessions</div>
                <div className="ms-toggle-sub">You’re signed in on 2 devices.</div>
              </div>
              <Button variant="ghost" size="sm">Sign out others</Button>
            </div>
          </section>

          <section id="ms-account" className="card ms-panel">
            <PanelHead ic="user" title="Account" sub="Your profile details." />
            <div className="ms-field-grid">
              <label className="ms-field"><span>Full name</span><input className="input" defaultValue={user.name === 'R. Malhotra' ? 'Rahul Malhotra' : user.name} /></label>
              <label className="ms-field"><span>Email</span><input className="input" defaultValue={user.email} /></label>
              <label className="ms-field"><span>Role</span><input className="input" defaultValue={role.label} disabled /></label>
              <label className="ms-field"><span>Region</span><input className="input" defaultValue={user.region} /></label>
            </div>
            <Button size="sm">Save changes</Button>
          </section>

          <section id="ms-activity" className="card ms-panel">
            <PanelHead ic="list" title="Activity Log" sub="Recent actions on your account." />
            <ul className="ms-activity">
              <li><span className="dot ai" /><b>Outlook connected</b><time>Today, 09:14</time></li>
              <li><span className="dot good" /><b>Confidence threshold set to 85%</b><time>Yesterday, 16:02</time></li>
              <li><span className="dot" /><b>Signed in from Mumbai</b><time>Mon, 08:31</time></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

function StatChip({ tile, ic, title, sub, pill }:
  { tile: 'good' | 'ai'; ic: IconName; title: string; sub: string; pill?: React.ReactNode }) {
  return (
    <div className="ms-stat">
      <span className={`ms-tile tile-${tile}`}><Icon name={ic} size={20} /></span>
      <div className="ms-stat-body">
        <b className="ms-stat-title">{title} {pill}</b>
        <span>{sub}</span>
      </div>
    </div>
  )
}

function PanelHead({ ic, title, sub }: { ic?: IconName; title: string; sub: string }) {
  return (
    <div className="ms-panel-head">
      {ic && <span className="ms-panel-ic"><Icon name={ic} size={18} /></span>}
      <div>
        <h3>{title}</h3>
        <p>{sub}</p>
      </div>
    </div>
  )
}

function SimpleToggle({ title, sub, def }: { title: string; sub: string; def?: boolean }) {
  const [on, setOn] = useState(!!def)
  return (
    <div className="ms-toggle-row">
      <div>
        <div className="ms-toggle-title">{title}</div>
        <div className="ms-toggle-sub">{sub}</div>
      </div>
      <Toggle on={on} onChange={setOn} label={<span className="ms-toggle-state">{on ? 'Enabled' : 'Off'}</span>} />
    </div>
  )
}

import './TeamAssignment.css'
import { useState } from 'react'
import { Button, Card, Modal, Pill, Toggle } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { CaseTimeline } from '../components/CaseTimeline'
import { useApp } from '../store'
import { ROLE_BY_CODE, DEMO_USERS } from '../mock/roles'
import { TEAM, TEAM_BY_ID, memberName } from '../mock/team'
import { effectiveAvailability, eligibleMembers, isOpenCase, isUserAvailable } from '../lib/assignment'
import type { Availability, CaseRecord, RoleCode, TeamMember } from '../types'

// Roles that actually carry a field/HQ roster worth showing on this screen (admin/leadership
// see everyone; the rest still render so the escalation ladder is visible end to end).
const ROLE_ORDER: RoleCode[] = ['ase_asm', 'finance', 'channel_dev', 'mdm', 'leadership']

export function TeamAssignment() {
  const flaggedCases = useApp((s) => s.flaggedCases)
  const availabilityByUser = useApp((s) => s.availabilityByUser)
  const setAvailability = useApp((s) => s.setAvailability)
  const reassignCase = useApp((s) => s.reassignCase)
  const escalateCase = useApp((s) => s.escalateCase)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'admin'
  const actorName = DEMO_USERS[viewingAs]?.name ?? 'You'

  const [expanded, setExpanded] = useState<string | null>(null)
  const [timelineCase, setTimelineCase] = useState<CaseRecord | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const openCases = flaggedCases.filter(isOpenCase)
  const workloadOf = (id: string) => openCases.filter((c) => c.assigneeId === id).length
  const casesOf = (id: string) => openCases.filter((c) => c.assigneeId === id)

  const onDuty = TEAM.filter((m) => isUserAvailable(m.id, availabilityByUser)).length
  const onLeave = TEAM.length - onDuty
  const unassigned = openCases.filter((c) => !c.assigneeId).length

  const toggleAvailability = (m: TeamMember, on: boolean) => {
    const current = effectiveAvailability(m.id, availabilityByUser)
    setAvailability(m.id, { ...current, status: on ? 'on_duty' : 'on_leave' }, actorName)
  }
  const setBackup = (m: TeamMember, backupUserId: string) => {
    const current = effectiveAvailability(m.id, availabilityByUser)
    setAvailability(m.id, { ...current, status: 'on_leave', backupUserId: backupUserId || undefined }, actorName)
  }

  const STATS: { label: string; value: number; tone: string; icon: 'user' | 'calendar' | 'approvals' | 'alert' }[] = [
    { label: 'On duty', value: onDuty, tone: 'good', icon: 'user' },
    { label: 'On leave', value: onLeave, tone: 'warn', icon: 'calendar' },
    { label: 'Open cases', value: openCases.length, tone: 'ai', icon: 'approvals' },
    { label: 'Unassigned', value: unassigned, tone: unassigned ? 'crit' : 'neutral', icon: 'alert' },
  ]

  return (
    <div>
      <div className="page-head">
        <h1>Team &amp; Assignment <span className="page-info-ic" title="Who owns what, who's on duty, and where work routes when someone's away."><Icon name="help" size={13} /></span></h1>
        <p className="page-sub">Person-level case ownership, availability and delegation. Setting someone to <b>On leave</b> hands their open cases to their backup (or the next on-duty peer).</p>
      </div>

      {actionMsg && (
        <div className="notify-bar" style={{ marginBottom: '1rem' }}>
          <Icon name="check" size={14} /> {actionMsg}
          <button className="btn text sm" style={{ marginLeft: 'auto' }} onClick={() => setActionMsg(null)}>Dismiss</button>
        </div>
      )}

      <div className="ta-stats">
        {STATS.map((s) => (
          <div className={`ta-stat tone-${s.tone}`} key={s.label}>
            <span className="ta-stat-ic"><Icon name={s.icon} size={15} /></span>
            <div><div className="ta-stat-val">{s.value}</div><div className="ta-stat-lbl">{s.label}</div></div>
          </div>
        ))}
      </div>

      {ROLE_ORDER.map((role) => {
        const members = TEAM.filter((m) => m.roleCode === role)
        if (!members.length) return null
        return (
          <Card key={role} title={`${ROLE_BY_CODE[role]?.label ?? role} — ${members.length}`} className="ta-card">
            <div className="ta-rows">
              {members.map((m) => {
                const av = effectiveAvailability(m.id, availabilityByUser)
                const available = isUserAvailable(m.id, availabilityByUser)
                const load = workloadOf(m.id)
                const mgr = m.managerId ? TEAM_BY_ID[m.managerId] : undefined
                const backupOptions = eligibleMembers(m.roleCode, m.state).filter((x) => x.id !== m.id)
                const isOpen = expanded === m.id
                return (
                  <div className={`ta-member ${available ? '' : 'is-leave'}`} key={m.id}>
                    <div className="ta-member-main">
                      <span className="ta-avatar">{m.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                      <div className="ta-id">
                        <div className="ta-name">{m.name} <span className="ta-level">{m.level}</span></div>
                        <div className="ta-meta">
                          {[m.state, m.region].filter(Boolean).join(' · ') || 'HQ'}
                          {mgr && <> · reports to {mgr.name}</>}
                        </div>
                      </div>

                      <button className="ta-load" onClick={() => setExpanded(isOpen ? null : m.id)} disabled={!load}
                        title={load ? 'Show assigned cases' : 'No open cases'}>
                        <b>{load}</b> case{load === 1 ? '' : 's'}
                        {!!load && <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />}
                      </button>

                      <div className="ta-avail">
                        <Pill tone={available ? 'good' : 'warn'} dot>{available ? 'On duty' : 'On leave'}</Pill>
                        <Toggle on={available} onChange={(on) => toggleAvailability(m, on)} />
                      </div>
                    </div>

                    {!available && (
                      <div className="ta-backup">
                        <Icon name="user" size={13} />
                        <span>Delegate to</span>
                        <select value={av.backupUserId ?? ''} onChange={(e) => setBackup(m, e.target.value)}>
                          <option value="">Auto (next on-duty peer)</option>
                          {backupOptions.map((b) => (
                            <option key={b.id} value={b.id} disabled={!isUserAvailable(b.id, availabilityByUser)}>
                              {b.name} ({b.level}){!isUserAvailable(b.id, availabilityByUser) ? ' — on leave' : ''}
                            </option>
                          ))}
                        </select>
                        {av.note && <span className="ta-note">“{av.note}”</span>}
                      </div>
                    )}

                    {isOpen && !!load && (
                      <div className="ta-cases">
                        {casesOf(m.id).map((c) => (
                          <CaseRow key={c.code} c={c} actorName={actorName}
                            onReassign={(to) => { reassignCase(c.code, to, actorName, 'manual reassignment'); setActionMsg(`${c.code} reassigned to ${memberName(to)}.`) }}
                            onEscalate={() => { const to = escalateCase(c.code, actorName, 'manual escalation'); setActionMsg(to ? `${c.code} escalated to ${to}.` : `${c.code} is already at the top of the chain — no one to escalate to.`) }}
                            onTimeline={() => setTimelineCase(c)} availabilityByUser={availabilityByUser} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}

      <Modal open={!!timelineCase} onClose={() => setTimelineCase(null)} title={`Case timeline — ${timelineCase?.code ?? ''}`}>
        {timelineCase && (
          <>
            <div className="ta-tl-head">{timelineCase.partnerName} · {timelineCase.town}</div>
            <CaseTimeline events={timelineCase.events} empty="No assignment activity recorded yet for this case." />
          </>
        )}
      </Modal>
    </div>
  )
}

function CaseRow({ c, onReassign, onEscalate, onTimeline, availabilityByUser }: {
  c: CaseRecord
  actorName: string
  onReassign: (to: string) => void
  onEscalate: () => void
  onTimeline: () => void
  availabilityByUser: Record<string, Availability>
}) {
  const peers = eligibleMembers(c.ownerRole, c.state).filter((m) => m.id !== c.assigneeId)
  return (
    <div className="ta-case">
      <div className="ta-case-id">{c.code}</div>
      <div className="ta-case-partner">{c.partnerName}<span>{c.town}</span></div>
      <Pill tone={c.isOverdue ? 'crit' : 'neutral'}>{c.slaLabel || '—'}</Pill>
      <div className="ta-case-actions">
        <select defaultValue="" onChange={(e) => { if (e.target.value) onReassign(e.target.value) }} title="Reassign to">
          <option value="">Reassign…</option>
          {peers.map((p) => (
            <option key={p.id} value={p.id} disabled={!isUserAvailable(p.id, availabilityByUser)}>
              {p.name}{!isUserAvailable(p.id, availabilityByUser) ? ' (leave)' : ''}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={onEscalate} title="Escalate up the manager chain"><Icon name="alert" size={13} /> Escalate</Button>
        <Button variant="ghost" size="sm" onClick={onTimeline} title="View case timeline"><Icon name="list" size={13} /></Button>
      </div>
    </div>
  )
}

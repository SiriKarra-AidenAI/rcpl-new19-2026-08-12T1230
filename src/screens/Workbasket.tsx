import './Workbasket.css'
import { useMemo, useState } from 'react'
import { Button, Card, Modal, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { CaseTimeline } from '../components/CaseTimeline'
import { useApp, useMe } from '../store'
import { memberName } from '../mock/team'
import { workbasketStats, worklistFor, loadByOwner, asesWithNoWork, assignableAses, asesByLoad } from '../lib/workbasket'
import { isUserAvailable } from '../lib/assignment'
import type { WorkbasketItem, WorkbasketStatus } from '../types'

const STATUS_LABEL: Record<WorkbasketStatus, string> = {
  unclaimed: 'Unassigned', picked: 'Picked', assigned: 'Assigned', in_progress: 'In progress', done: 'Done',
}
const STATUS_TONE: Record<WorkbasketStatus, 'good' | 'warn' | 'crit' | 'ai' | 'neutral'> = {
  unclaimed: 'neutral', picked: 'ai', assigned: 'ai', in_progress: 'warn', done: 'good',
}

// ---- small presentation helpers for the redesigned pool table ----
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
const AV_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
const avColor = (s: string) => AV_COLORS[s.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length]
const TIER_CLASS: Record<string, string> = { 'Tier 1': 't1', 'Tier 2': 't2', 'Tier 3': 't3' }

// DB name cell — a colored initials tile anchors each row, so the table scans as a list of entities.
// Once the DB has become a lead (in_progress or done — see leadFromWorkbasketDb in store.ts),
// the name is clickable and deep-links to that lead's own detail view on Leads.
function DbName({ name, flagged, onOpen }: { name: string; flagged?: boolean; onOpen?: () => void }) {
  const color = avColor(name)
  const inner = <>
    <span className="wb-db-ic" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>{initials(name)}</span>
    <span className="wb-db-name">{name}{flagged && <Pill tone="crit" dot>Flagged</Pill>}</span>
  </>
  return onOpen
    ? <button type="button" className="wb-db wb-db-link" onClick={onOpen} title={`View ${name}'s distributor details`}>{inner}</button>
    : <div className="wb-db">{inner}</div>
}
const TierBadge = ({ tier }: { tier: string }) => <span className={`wb-tier ${TIER_CLASS[tier] ?? 't3'}`}>{tier}</span>

/** The shared DB Pool, shown inline on Leads. Distribution is top-down: an ASE (the field worker)
 *  only ever sees the DBs ASSIGNED to them; the ASM/RBL see the whole pool + each ASE's workload
 *  and hand DBs down to whoever has the least work. No browse-and-pick for the field team. */
export function WorkbasketPanel({ defaultOpen = true, onOpenLead }: { defaultOpen?: boolean; onOpenLead?: (id: string) => void }) {
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const workbasket = useApp((s) => s.workbasket)
  const assignWorkbasketItem = useApp((s) => s.assignWorkbasketItem)
  const assignWorkbasketItems = useApp((s) => s.assignWorkbasketItems)
  const reassignWorkbasketItem = useApp((s) => s.reassignWorkbasketItem)
  const unassignWorkbasketItemsByOwner = useApp((s) => s.unassignWorkbasketItemsByOwner)
  const advanceWorkbasketItem = useApp((s) => s.advanceWorkbasketItem)
  const flagWorkbasketItem = useApp((s) => s.flagWorkbasketItem)
  const unflagWorkbasketItem = useApp((s) => s.unflagWorkbasketItem)
  const availabilityByUser = useApp((s) => s.availabilityByUser)
  const setAvailability = useApp((s) => s.setAvailability)

  // The REAL logged-in person when authenticated (so two different ASEs/ASMs genuinely see
  // different data), falling back to the persona-switcher's representative in demo mode.
  const me = useMe()
  const myId = me?.id ?? ''
  const actorName = me?.name ?? 'You'
  // A DB only gets a real Lead record (lead-${id}) once its status hits in_progress or done —
  // see leadFromWorkbasketDb/advanceWorkbasketItem in store.ts. Only clickable when the parent
  // (Leads.tsx) actually gave us a way to open it — the "created leads" table it jumps to only
  // exists there.
  const hasLead = (i: WorkbasketItem) => !!onOpenLead && (i.status === 'in_progress' || i.status === 'done')
  const openLead = (i: WorkbasketItem) => onOpenLead?.(`lead-${i.id}`)

  // ASE = field worker (sees only their assigned DBs). ASM/RBL/admin = assigners (see the pool).
  const canAssign = viewingAs === 'asm' || viewingAs === 'rbl' || viewingAs === 'admin'

  const [scope, setScope] = useState<'unclaimed' | 'flagged' | 'all'>('all')
  const [stateFilter, setStateFilter] = useState<'all' | string>('all')
  const [query, setQuery] = useState('')
  const [timelineItem, setTimelineItem] = useState<WorkbasketItem | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(defaultOpen)

  const stats = useMemo(() => workbasketStats(workbasket), [workbasket])
  const states = useMemo(() => [...new Set(workbasket.map((i) => i.state))].sort(), [workbasket])
  const load = useMemo(() => loadByOwner(workbasket), [workbasket])
  const idle = useMemo(() => asesWithNoWork(workbasket), [workbasket])
  const idleIds = useMemo(() => new Set(idle.map((m) => m.id)), [idle])
  const ases = assignableAses()
  const notify = (m: string) => setActionMsg(m)

  const onLeave = (id: string) => !isUserAvailable(id, availabilityByUser)
  const aseOption = (m: { id: string; name: string }) => `${m.name}${onLeave(m.id) ? ' — on leave' : idleIds.has(m.id) ? ' — idle' : ` (${load[m.id] ?? 0})`}`
  // Assign/reassign options — on-leave ASEs are shown but disabled so work can't be handed to them.
  const aseOptions = (excludeId?: string) => ases.filter((m) => m.id !== excludeId).map((m) => (
    <option key={m.id} value={m.id} disabled={onLeave(m.id)}>{aseOption(m)}</option>
  ))

  // ─────────── ASE worker view: only the DBs assigned to me ───────────
  if (!canAssign) {
    const mine = worklistFor(workbasket, myId)
    return (
      <Card className="wb-card">
        <div className="row-between" style={{ alignItems: 'flex-start', gap: '0.6rem' }}>
          <button className="wb-head" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ flex: 1 }}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} />
            <div className="wb-head-txt">
              <div className="wb-head-title">My assigned DBs ({mine.length})</div>
              <div className="wb-head-sub">DBs your RBL/ASM has assigned to you to work. Advance one as you progress, or flag it if you can't act on it.</div>
            </div>
          </button>
          {mine.length > 0 && (
            <Button variant="ghost" size="sm" onClick={(e) => {
              e.stopPropagation()
              unassignWorkbasketItemsByOwner(myId, actorName)
              notify(`Released all ${mine.length} DBs back to the pool.`)
            }}><Icon name="close" size={13} /> Release all ({mine.length})</Button>
          )}
        </div>
        {open && (<>
          {actionMsg && (
            <div className="notify-bar" style={{ marginTop: '0.8rem' }}>
              <Icon name="check" size={14} /> {actionMsg}
              <button className="btn text sm" style={{ marginLeft: 'auto' }} onClick={() => setActionMsg(null)}>Dismiss</button>
            </div>
          )}
          <div className="dtable-wrap" style={{ marginTop: '0.8rem' }}>
            <table className="dtable wb-table">
              <thead><tr><th>DB</th><th>Town / State</th><th>Tier</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {mine.map((i) => (
                  <tr key={i.id} className={i.flagged ? 'wb-flagged' : ''}>
                    <td className="strong"><DbName name={i.dbName} flagged={i.flagged} onOpen={hasLead(i) ? () => openLead(i) : undefined} /></td>
                    <td className="wb-town">{i.town}<span className="cell-sub">{i.state}{i.scoutingCaseCode ? ` · ${i.scoutingCaseCode}` : ''}</span></td>
                    <td><TierBadge tier={i.companyTier} /></td>
                    <td><Pill tone={STATUS_TONE[i.status]} dot>{STATUS_LABEL[i.status]}</Pill></td>
                    <td className="wb-row-actions">
                      {i.status !== 'done' && (
                        <Button size="sm" onClick={() => { advanceWorkbasketItem(i.id, actorName); notify(`${i.dbName} advanced.`) }}>
                          <Icon name="chevronRight" size={12} /> {i.status === 'in_progress' ? 'Mark done' : 'Start'}
                        </Button>
                      )}
                      {i.flagged
                        ? <Button variant="ghost" size="sm" onClick={() => { unflagWorkbasketItem(i.id, actorName); notify(`Cleared flag on ${i.dbName}.`) }}>Clear flag</Button>
                        : <Button variant="ghost" size="sm" onClick={() => { flagWorkbasketItem(i.id, 'Flagged by owner — needs attention', actorName); notify(`Flagged ${i.dbName}.`) }}><Icon name="flag" size={12} /> Flag</Button>}
                      <Button variant="ghost" size="sm" onClick={() => setTimelineItem(i)} title="History"><Icon name="list" size={13} /></Button>
                    </td>
                  </tr>
                ))}
                {mine.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: '1.2rem 0' }}>No DBs assigned to you yet — your RBL/ASM assigns work here.</td></tr>}
              </tbody>
            </table>
          </div>
        </>)}
        <Modal open={!!timelineItem} onClose={() => setTimelineItem(null)} title={`History — ${timelineItem?.dbName ?? ''}`}>
          {timelineItem && (<><div className="wb-tl-head">{timelineItem.town}, {timelineItem.state} · shortlisted by {memberName(timelineItem.shortlistedByAseId)}</div>
            <CaseTimeline events={timelineItem.events} empty="No activity recorded yet." /></>)}
        </Modal>
      </Card>
    )
  }

  // ─────────── ASM / RBL assigner view: full pool + per-ASE load + assign ───────────
  const rows = workbasket.filter((i) => {
    if (scope === 'unclaimed' && i.status !== 'unclaimed') return false
    if (scope === 'flagged' && !i.flagged) return false
    if (stateFilter !== 'all' && i.state !== stateFilter) return false
    const q = query.trim().toLowerCase()
    if (q && !i.dbName.toLowerCase().includes(q) && !i.town.toLowerCase().includes(q)) return false
    return true
  })
  const selectableRows = rows.filter((i) => i.status === 'unclaimed')
  const allSelected = selectableRows.length > 0 && selectableRows.every((i) => selected.has(i.id))
  const toggleRow = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableRows.map((i) => i.id)))
  const bulkAssign = (to: string) => {
    const ids = [...selected]
    assignWorkbasketItems(ids, to, actorName)
    notify(`Assigned ${ids.length} DB${ids.length > 1 ? 's' : ''} to ${memberName(to)}.`)
    setSelected(new Set())
  }
  const SCOPES: { id: typeof scope; label: string; n: number }[] = [
    { id: 'unclaimed', label: 'Unassigned', n: stats.unclaimed },
    { id: 'flagged', label: 'Flagged', n: stats.flagged },
    { id: 'all', label: 'All', n: stats.total },
  ]

  return (
    <Card className="wb-card">
      <button className="wb-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} />
        <div className="wb-head-txt">
          <div className="wb-head-title">DB Pool — field team &amp; assignment</div>
          <div className="wb-head-sub">
            {stats.total} DBs shortlisted by the field team · {stats.picked + stats.assigned + stats.inProgress} in ASE worklists (each with the ASE who scouted it) · reassign to rebalance
            {stats.unclaimed > 0 ? ` · ${stats.unclaimed} unassigned` : ''}
          </div>
        </div>
      </button>

      {open && (<>
        {/* Per-ASE workload — hand unassigned DBs to whoever has the least. Idle ASEs highlighted. */}
        <div className="wb-load" style={{ marginTop: '0.9rem' }}>
          {asesByLoad(workbasket).map(({ member, load: n }) => {
            const leave = onLeave(member.id)
            return (
              <span className={`wb-load-chip ${leave ? 'leave' : idleIds.has(member.id) ? 'idle' : ''}`} key={member.id}>
                <span className="wb-load-av" style={{ background: `color-mix(in srgb, ${avColor(member.name)} 18%, transparent)`, color: avColor(member.name) }}>{initials(member.name)}</span>
                <span className="wb-load-nm">{member.name}</span>
                {leave
                  ? <em className="wb-load-leave">On leave</em>
                  : <>{idleIds.has(member.id) ? <em className="wb-load-idle">idle</em> : <b className="wb-load-n">{n}</b>}</>}
                <button className="wb-leave-btn" title={leave ? `Mark ${member.name} back on duty` : `Mark ${member.name} on leave`}
                  onClick={() => { setAvailability(member.id, { status: leave ? 'on_duty' : 'on_leave' }, actorName); notify(`${member.name} marked ${leave ? 'on duty' : 'on leave'}.`) }}>
                  <Icon name={leave ? 'check' : 'calendar'} size={12} />
                </button>
                {n > 0 && (
                  <button className="wb-leave-btn" title={`Unassign all ${n} DB${n > 1 ? 's' : ''} from ${member.name} — back to Unassigned for you to hand out again`}
                    onClick={() => { unassignWorkbasketItemsByOwner(member.id, actorName); notify(`Unassigned ${n} DB${n > 1 ? 's' : ''} from ${member.name} — back in the pool.`) }}>
                    <Icon name="close" size={12} />
                  </button>
                )}
              </span>
            )
          })}
        </div>
        <p className="wb-load-hint">Tap the <Icon name="calendar" size={11} /> on a teammate to mark them on leave — their open DBs get reassigned and they drop out of the assign list. ASEs can also set their own leave in <b>My Settings</b>.</p>

        {actionMsg && (
          <div className="notify-bar" style={{ marginTop: '0.8rem' }}>
            <Icon name="check" size={14} /> {actionMsg}
            <button className="btn text sm" style={{ marginLeft: 'auto' }} onClick={() => setActionMsg(null)}>Dismiss</button>
          </div>
        )}

        {selected.size > 0 && (
          <div className="wb-bulk-bar">
            <span><b>{selected.size}</b> selected</span>
            <select defaultValue="" onChange={(e) => { if (e.target.value) { bulkAssign(e.target.value); e.currentTarget.value = '' } }} title="Bulk assign to an ASE">
              <option value="">Bulk assign to…</option>
              {aseOptions()}
            </select>
            <button className="btn text sm" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}

        <div className="wb-filters">
          <div className="wb-scope">
            {SCOPES.map((s) => <button key={s.id} className={scope === s.id ? 'on' : ''} onClick={() => setScope(s.id)}>{s.label} ({s.n})</button>)}
          </div>
          <div className="wb-search"><Icon name="search" size={14} /><input placeholder="Search DB or town…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            <option value="all">All states</option>
            {states.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <span className="wb-count">{rows.length} shown</span>
        </div>

        <div className="dtable-wrap">
          <table className="dtable wb-table">
            <thead><tr>
              <th className="wb-check"><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all unassigned" aria-label="Select all unassigned" /></th>
              <th>DB</th><th>Town / State</th><th>Tier</th><th>Shortlisted by</th><th>Status</th><th>Assigned to</th><th aria-label="Actions" />
            </tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={i.flagged ? 'wb-flagged' : ''}>
                  <td className="wb-check">{i.status === 'unclaimed' && <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleRow(i.id)} aria-label={`Select ${i.dbName}`} />}</td>
                  <td className="strong"><DbName name={i.dbName} flagged={i.flagged} onOpen={hasLead(i) ? () => openLead(i) : undefined} /></td>
                  <td className="wb-town">{i.town}<span className="cell-sub">{i.state}{i.scoutingCaseCode ? ` · ${i.scoutingCaseCode}` : ''}</span></td>
                  <td><TierBadge tier={i.companyTier} /></td>
                  <td>{memberName(i.shortlistedByAseId)}</td>
                  <td><Pill tone={STATUS_TONE[i.status]} dot>{STATUS_LABEL[i.status]}</Pill></td>
                  <td>{i.ownerId ? memberName(i.ownerId) : <span className="muted-note" style={{ margin: 0 }}>—</span>}</td>
                  <td className="wb-row-actions">
                    {i.status === 'unclaimed'
                      ? <select className="wb-assign" defaultValue="" onChange={(e) => { if (e.target.value) { assignWorkbasketItem(i.id, e.target.value, actorName); notify(`Assigned ${i.dbName} to ${memberName(e.target.value)}.`) } }} title="Assign to an ASE">
                          <option value="">Assign to…</option>
                          {aseOptions()}
                        </select>
                      : <select className="wb-assign" defaultValue="" onChange={(e) => { if (e.target.value) { reassignWorkbasketItem(i.id, e.target.value, actorName, 'supervisor rebalance'); notify(`Reassigned ${i.dbName} to ${memberName(e.target.value)}.`) } }} title="Reassign to another ASE">
                          <option value="">Reassign…</option>
                          {aseOptions(i.ownerId)}
                        </select>}
                    <Button variant="ghost" size="sm" onClick={() => setTimelineItem(i)} title="History"><Icon name="list" size={13} /></Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: '1.2rem 0' }}>No DBs match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}

      <Modal open={!!timelineItem} onClose={() => setTimelineItem(null)} title={`History — ${timelineItem?.dbName ?? ''}`}>
        {timelineItem && (<><div className="wb-tl-head">{timelineItem.town}, {timelineItem.state} · shortlisted by {memberName(timelineItem.shortlistedByAseId)}</div>
          <CaseTimeline events={timelineItem.events} empty="No activity recorded yet." /></>)}
      </Modal>
    </Card>
  )
}

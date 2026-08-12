// Pure selectors over the workbasket pool — no side effects, mirrors lib/assignment.ts.
// The store holds the WorkbasketItem[]; these functions derive the views every screen and
// dashboard widget renders (stats, a person's worklist, the RBL's assign targets, per-owner load).

import type { TeamMember, WorkbasketItem, WorkbasketStatus } from '../types'
import { TEAM } from '../mock/team'

export interface WorkbasketStats {
  total: number
  unclaimed: number
  picked: number
  assigned: number
  inProgress: number
  done: number
  flagged: number
}

/** Count of items in each status bucket (+ how many are flagged), across the whole pool. */
export function workbasketStats(items: WorkbasketItem[]): WorkbasketStats {
  const s: WorkbasketStats = { total: items.length, unclaimed: 0, picked: 0, assigned: 0, inProgress: 0, done: 0, flagged: 0 }
  for (const it of items) {
    if (it.flagged) s.flagged++
    switch (it.status) {
      case 'unclaimed': s.unclaimed++; break
      case 'picked': s.picked++; break
      case 'assigned': s.assigned++; break
      case 'in_progress': s.inProgress++; break
      case 'done': s.done++; break
    }
  }
  return s
}

/** Items a person owns — the "My Worklist" view for an ASM (picked + assigned + in progress + done). */
export function worklistFor(items: WorkbasketItem[], userId: string): WorkbasketItem[] {
  return items.filter((it) => it.ownerId === userId)
}

/** Items a given ASE shortlisted into the pool — the ASE's "what I contributed" view. */
export function contributedBy(items: WorkbasketItem[], aseId: string): WorkbasketItem[] {
  return items.filter((it) => it.shortlistedByAseId === aseId)
}

/** The leftovers no one has picked yet — the RBL's assignable pool. */
export function unpickedItems(items: WorkbasketItem[]): WorkbasketItem[] {
  return items.filter((it) => it.status === 'unclaimed')
}

/** How many open (not done) items each owner currently carries. */
export function loadByOwner(items: WorkbasketItem[]): Record<string, number> {
  const load: Record<string, number> = {}
  for (const it of items) {
    if (!it.ownerId || it.status === 'done') continue
    load[it.ownerId] = (load[it.ownerId] ?? 0) + 1
  }
  return load
}

/** The field workers a DB can be assigned to — ASEs (roleCode 'ase_asm', level 'ASE'). The RBL/ASM
 *  distribute the shortlisted DBs across these; the ASE then works whatever lands in their worklist. */
export function assignableAses(team: TeamMember[] = TEAM): TeamMember[] {
  return team.filter((m) => m.roleCode === 'ase_asm' && m.level === 'ASE' && m.isActive !== false)
}

/** ASEs carrying no open DBs — the RBL/ASM's preferred targets when balancing load
 *  ("assign a case to an ASE who has no cases, or very few"). */
export function asesWithNoWork(items: WorkbasketItem[], team: TeamMember[] = TEAM): TeamMember[] {
  const load = loadByOwner(items)
  return assignableAses(team).filter((m) => !load[m.id])
}

/** ASEs sorted lightest-load first — the order the RBL/ASM should hand work out in. */
export function asesByLoad(items: WorkbasketItem[], team: TeamMember[] = TEAM): { member: TeamMember; load: number }[] {
  const load = loadByOwner(items)
  return assignableAses(team)
    .map((member) => ({ member, load: load[member.id] ?? 0 }))
    .sort((a, b) => a.load - b.load)
}

/** The next status when an owner advances an item along picked/assigned → in_progress → done. */
export function nextWorkStatus(status: WorkbasketStatus): WorkbasketStatus | null {
  if (status === 'picked' || status === 'assigned') return 'in_progress'
  if (status === 'in_progress') return 'done'
  return null
}

// The people roster behind the coarse RoleCode personas. Several members share a RoleCode
// (e.g. multiple ASEs in the same territory) — which is exactly what lets work be reassigned
// when someone goes on leave. `managerId` forms the escalation ladder ASE → ASM → SM → RBL.
//
// Ids u1–u6 are the same identities as DEMO_USERS (mock/roles.ts) so the persona switcher's
// "current person" for a role resolves to a real roster member. Everyone else is net-new here.

import type { RoleCode, TeamMember } from '../types'

export const TEAM: TeamMember[] = [
  // ── Field sales · West / Maharashtra (three ASEs → round-robin + reassignment demoable) ──
  { id: 'u1', name: 'R. Malhotra', email: 'r.malhotra@rcpl.in', roleCode: 'ase_asm', level: 'ASE', region: 'West', state: 'Maharashtra', managerId: 'u-asm-w', availability: { status: 'on_duty' } },
  { id: 'u-ase-2', name: 'K. Bhosale', email: 'k.bhosale@rcpl.in', roleCode: 'ase_asm', level: 'ASE', region: 'West', state: 'Maharashtra', managerId: 'u-asm-w', availability: { status: 'on_duty' } },
  { id: 'u-ase-3', name: 'A. Joshi', email: 'a.joshi@rcpl.in', roleCode: 'ase_asm', level: 'ASE', region: 'West', state: 'Maharashtra', managerId: 'u-asm-w',
    // Seeded on leave so the auto-reassignment behaviour is visible out of the box; work delegates
    // to K. Bhosale. R. Malhotra (the default persona) stays on duty so the demo persona is unaffected.
    availability: { status: 'on_leave', fromDate: '2026-07-18', toDate: '2026-07-25', backupUserId: 'u-ase-2', note: 'Planned leave' } },

  // ── Field sales · South / Karnataka ──
  { id: 'u-ase-4', name: 'N. Rao', email: 'n.rao@rcpl.in', roleCode: 'ase_asm', level: 'ASE', region: 'South', state: 'Karnataka', managerId: 'u-asm-s', availability: { status: 'on_duty' } },

  // ── Managers (escalation ladder) — ASM persona ──
  { id: 'u-asm-w', name: 'D. Kulkarni', email: 'd.kulkarni@rcpl.in', roleCode: 'asm', level: 'ASM', region: 'West', state: 'Maharashtra', managerId: 'u-sm-w', availability: { status: 'on_duty' } },
  // A second West ASM who starts with an empty worklist — the RBL's target when handing out
  // unpicked workbasket DBs ("assign the leftovers to an ASM who hasn't picked any yet").
  { id: 'u-asm-w2', name: 'S. Patil', email: 's.patil@rcpl.in', roleCode: 'asm', level: 'ASM', region: 'West', state: 'Maharashtra', managerId: 'u-sm-w', availability: { status: 'on_duty' } },
  { id: 'u-asm-s', name: 'M. Reddy', email: 'm.reddy@rcpl.in', roleCode: 'asm', level: 'ASM', region: 'South', state: 'Karnataka', managerId: 'u-sm-w', availability: { status: 'on_duty' } },
  { id: 'u-sm-w', name: 'V. Menon', email: 'v.menon@rcpl.in', roleCode: 'asm', level: 'SM', region: 'West', managerId: 'u-rbl', availability: { status: 'on_duty' } },
  // RBL — the regional supervisor persona (own RoleCode 'rbl'), top of the escalation ladder.
  { id: 'u-rbl', name: 'R. Krishnan', email: 'r.krishnan@rcpl.in', roleCode: 'rbl', level: 'RBL', region: 'West', availability: { status: 'on_duty' } },

  // ── HQ gatekeepers ──
  { id: 'u2', name: 'S. Iyer', email: 's.iyer@rcpl.in', roleCode: 'finance', level: 'HQ', region: 'HQ', availability: { status: 'on_duty' } },       // Finance Controller
  { id: 'u-fin-2', name: 'A. Banerjee', email: 'a.banerjee@rcpl.in', roleCode: 'finance', level: 'HQ', region: 'HQ', availability: { status: 'on_duty' } },
  { id: 'u2b', name: 'V. Rao', email: 'v.rao@rcpl.in', roleCode: 'finance', level: 'HQ', region: 'HQ', isActive: false, availability: { status: 'on_duty' } },
  { id: 'u3', name: 'A. Deshpande', email: 'a.deshpande@rcpl.in', roleCode: 'channel_dev', level: 'HQ', region: 'West', state: 'Gujarat', availability: { status: 'on_duty' } }, // Channel Mgmt Lead
  { id: 'u-chan-2', name: 'P. Gupta', email: 'p.gupta@rcpl.in', roleCode: 'channel_dev', level: 'HQ', region: 'HQ', availability: { status: 'on_duty' } },
  { id: 'u4', name: 'P. Nair', email: 'p.nair@rcpl.in', roleCode: 'mdm', level: 'HQ', region: 'HQ', availability: { status: 'on_duty' } },
  { id: 'u4b', name: 'T. Sen', email: 't.sen@rcpl.in', roleCode: 'mdm', level: 'HQ', region: 'East', availability: { status: 'on_duty' } },
  { id: 'u7', name: 'K. Subramaniam', email: 'k.subramaniam@rcpl.in', roleCode: 'it', level: 'HQ', region: 'HQ', availability: { status: 'on_duty' } },
  { id: 'u5', name: 'Atishay Jain', email: 'atishay.jain@rcpl.in', roleCode: 'leadership', level: 'HQ', region: 'HQ', availability: { status: 'on_duty' } },
  { id: 'u6', name: 'Platform Admin', email: 'admin@rcpl.in', roleCode: 'admin', level: 'HQ', region: 'HQ', availability: { status: 'on_duty' } },
]

export const TEAM_BY_ID: Record<string, TeamMember> = TEAM.reduce(
  (acc, m) => { acc[m.id] = m; return acc },
  {} as Record<string, TeamMember>,
)

/** The "logged-in person" for a persona (RoleCode) — the first roster member with that role,
 *  matching DEMO_USERS' single-user-per-role identity (u1 for ase_asm, u2 for finance, …). */
export const PRIMARY_USER_BY_ROLE: Record<RoleCode, string> = TEAM.reduce((acc, m) => {
  if (!acc[m.roleCode]) acc[m.roleCode] = m.id
  return acc
}, {} as Record<RoleCode, string>)

export const memberName = (id?: string): string => (id ? TEAM_BY_ID[id]?.name ?? id : 'Unassigned')

export const isAvailable = (m: TeamMember): boolean => m.isActive !== false && m.availability.status === 'on_duty'

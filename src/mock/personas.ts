import type { User } from '../types'
import { DEFAULT_ACCESS_BY_ROLE } from './roles'
import { TEAM } from './team'

// Single source of truth for people: the Admin user directory is derived from the same TEAM
// roster that drives case assignment/reassignment — so anyone you can reassign a case to also
// shows up in Admin › Team, and vice versa (no phantom names in one list but not the other).
export const INITIAL_USERS: User[] = TEAM.map((m) => ({
  id: m.id,
  name: m.name,
  email: m.email,
  roleCode: m.roleCode,
  region: m.region,
  state: m.state,
  isActive: m.isActive !== false,
  access: DEFAULT_ACCESS_BY_ROLE[m.roleCode],
}))

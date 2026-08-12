import type { ReactNode } from 'react'
import type { RoleCode } from '../../types'
import { useApp } from '../../store'
import { Forbidden } from '../../screens/Forbidden'

// Frontend-only RBAC: blocks a route to specific logged-in roles, even if the
// user reaches the URL directly (nav already hides it, but the URL itself
// must be gated too — otherwise any authenticated user could type it in).
export function RequireRole({ allow, children }: { allow: RoleCode[]; children: ReactNode }) {
  const roleCode = useApp((s) => s.roleCode)
  if (!roleCode || !allow.includes(roleCode)) return <Forbidden />
  return <>{children}</>
}

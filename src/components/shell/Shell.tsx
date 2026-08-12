import './Shell.css'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { NAV, LABEL_BY_PATH } from './nav'
import { Copilot } from './Copilot'
import { BrandMark } from '../BrandMark'
import { Icon } from '../ui/icons'
import { useApp, useMe, allowedScreens } from '../../store'
import { ROLE_BY_CODE } from '../../mock/roles'
import { EXTRACTIONS, unprocessedIntakeCount } from '../../mock/intake'
import { isMyLead } from '../../mock/candidates'
import type { Extraction } from '../../mock/intake'
import type { Scenario } from '../../types'

const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('')

export function Shell() {
  const loc = useLocation()
  const navigate = useNavigate()
  const copilotOpen = useApp((s) => s.copilotOpen)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const moduleAccess = useApp((s) => s.moduleAccess)
  const scenario = useApp((s) => s.scenario)
  const setScenario = useApp((s) => s.setScenario)
  const logout = useApp((s) => s.logout)
  const checkSlaBreaches = useApp((s) => s.checkSlaBreaches)
  // Auto-escalate cases whose SLA has expired — on load and every minute while the app is open.
  useEffect(() => {
    checkSlaBreaches()
    const t = setInterval(() => checkSlaBreaches(), 60_000)
    return () => clearInterval(t)
  }, [checkSlaBreaches])
  const allNotifications = useApp((s) => s.notifications)
  const markNotificationRead = useApp((s) => s.markNotificationRead)
  const markAllNotificationsRead = useApp((s) => s.markAllNotificationsRead)
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const me = useMe()
  const processedIntakeIds = useApp((s) => s.processedIntakeIds)
  const candidates = useApp((s) => s.candidates)
  const flaggedCases = useApp((s) => s.flaggedCases)
  const commThreads = useApp((s) => s.commThreads)
  const grievances = useApp((s) => s.grievances)

  // Keeps EXTRACTIONS (and so the Intake Inbox badge below) live regardless of which screen is
  // open — IntakeInbox.tsx's own poll only runs while that screen is mounted, but the sidebar
  // is mounted the whole session, so the badge needs its own independent refresh.
  const [, setIntakeTick] = useState(0)
  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        const res = await fetch('/api/intake')
        if (!res.ok) return
        const items: Extraction[] = await res.json()
        let changed = false
        for (const it of items) {
          const existing = EXTRACTIONS[it.id]
          if (!existing || JSON.stringify(existing) !== JSON.stringify(it)) { EXTRACTIONS[it.id] = it; changed = true }
        }
        if (changed && alive) setIntakeTick((n) => n + 1)
      } catch { /* server not running — badge falls back to whatever EXTRACTIONS already has */ }
    }
    pull()
    // Matches the backend's own IMAP poll cadence (INTAKE_POLL_SECONDS, default 10s) so a
    // freshly-captured email shows up here without an extra ~20s on top of that wait.
    const t = window.setInterval(pull, 8000)
    return () => { alive = false; window.clearInterval(t) }
  }, [])

  const createdLeadNames = new Set(candidates.filter((c) => c.userCreated).map((c) => c.name.toLowerCase()))
  const myLeadsCount = candidates.filter((c) =>
    c.userCreated && c.stage !== 'active' && (viewingAs !== 'ase_asm' || isMyLead(c, me?.id, viewingAs))).length
  const myApprovalsCount = flaggedCases.filter((c) => c.status === 'flagged' && (c.ownerRole === viewingAs || viewingAs === 'admin')).length
  const myCommsCount = commThreads.filter((t) => t.participants.some((m) => m.isNextReplier)).length
  const myGrievancesCount = grievances.filter((g) => g.status !== 'resolved').length
  // Overrides NAV's static placeholder counts with the real, live numbers — computed once here
  // instead of scattered per-item, so every badge stays provably tied to what its own screen lists.
  const LIVE_COUNT_BY_PATH: Record<string, number> = {
    '/intake-inbox': unprocessedIntakeCount(processedIntakeIds, createdLeadNames),
    '/leads': myLeadsCount,
    '/approvals': myApprovalsCount,
    '/communication': myCommsCount,
    '/grievances': myGrievancesCount,
  }
  // Role-targeted notifications (e.g. shortlist hand-offs addressed to Trade Marketing /
  // Channel Development) only show to that persona; untargeted ones show to everyone.
  const notifications = allNotifications.filter((n) => !n.forRole || n.forRole === viewingAs)
  const unreadCount = notifications.filter((n) => !n.read).length

  const role = ROLE_BY_CODE[viewingAs]
  // The real logged-in person when authenticated, not the one fixed per-role stand-in — otherwise
  // the header keeps showing e.g. "R. Malhotra" for every ase_asm login, even after signing in as
  // a different ASE, which reads as "the app didn't actually log me in as who I picked."
  const user = me ?? { name: role.label, id: '' }
  const current = LABEL_BY_PATH[loc.pathname] ?? sectionLabel(loc.pathname)

  // Role ceiling (Admin > Screen access) narrowed by this specific person's own View toggle
  // (Admin > Team > Edit user) — see allowedScreens' doc comment in store.ts.
  const allowed = allowedScreens(moduleAccess[viewingAs] ?? [], me)
  const groups = NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => allowed.includes(i.to)) }))
    .filter((g) => g.items.length > 0)

  // Detail routes reachable from within modules (not in the sidebar) bypass the guard.
  const EXEMPT_ROUTES = ['/distributor', '/intake/']
  // Dashboard is fully editable now (Admin > Screen access / Edit user), so it's no longer a
  // guaranteed landing page — fall back to whatever this persona/user's FIRST allowed screen is;
  // '/dashboard' only survives as the very last resort if literally nothing is allowed them.
  const landingPath = allowed[0] ?? '/dashboard'
  // If the active persona can't see the current module, send them to their actual landing page.
  useEffect(() => {
    const exempt = EXEMPT_ROUTES.some((r) => loc.pathname.startsWith(r))
    if (!exempt && !allowed.includes(loc.pathname) && loc.pathname !== landingPath) {
      navigate(landingPath, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingAs, loc.pathname, allowed, landingPath, navigate])

  useEffect(() => {
    if (!notifOpen) return
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [notifOpen])

  const openNotification = (id: string, href: string) => {
    markNotificationRead(id)
    setNotifOpen(false)
    navigate(href)
  }

  return (
    <div className={`shell ${copilotOpen ? 'with-copilot' : ''}`}>
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="sb-logo-card"><BrandMark /></div>
          <span className="sb-division">Staples Division</span>
        </div>
        {groups.map((group) => (
          <div key={group.label}>
            <div className="sb-group-label">{group.label}</div>
            {group.items.map((item) => {
              const count = LIVE_COUNT_BY_PATH[item.to] ?? item.count
              return (
                <NavLink key={item.to} to={item.to} title={item.label} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span className="ic"><Icon name={item.ic} /></span>
                  <span className="nav-label">{item.label}</span>
                  {!!count && <span className="count">{count}</span>}
                </NavLink>
              )
            })}
          </div>
        ))}
        <div className="sb-copilot">
          <div className="sb-user">
            <span className="avatar" style={{ background: `var(${role.colorVar})` }}>{initials(user.name)}</span>
            <div className="sb-user-meta">
              <b>{user.name}</b>
              <span>{role.label}</span>
            </div>
            <button className="sb-logout" title="Sign out" onClick={() => { logout(); navigate('/login') }}><Icon name="logout" size={16} /></button>
          </div>
        </div>
      </aside>

      <div className="content-col">
        <header className="topbar">
          {loc.pathname !== '/dashboard' && (
            <button className="back-btn" onClick={() => navigate(-1)} title="Go back" aria-label="Go back">
              <Icon name="back" size={16} /> Back
            </button>
          )}
          <nav className="crumbs">
            <span>RCPL</span>
            <span className="sep">/</span>
            <span className="cur">{current}</span>
          </nav>

          <div className="topbar-search">
            <Icon name="search" size={15} />
            <input placeholder="Search cases, partners, distributors…" aria-label="Search" />
            <kbd>⌘K</kbd>
          </div>

          <div className="topbar-spacer" />

          <div className="agents-live" title="Simulated agents online"><span className="live-dot" />6 agents active</div>

          <div className="topbar-ctrl">
            <div className="seg" role="group" aria-label="Demo scenario">
              {(['clean', 'flagged'] as Scenario[]).map((s) => (
                <button key={s} className={scenario === s ? `on ${s}` : ''} onClick={() => setScenario(s)}>
                  {s === 'clean' ? 'Auto-clear' : 'Flagged'}
                </button>
              ))}
            </div>
          </div>

          <div className="notif-wrap" ref={notifRef}>
            <button className="icon-btn" title="Notifications" aria-label="Notifications" onClick={() => setNotifOpen((v) => !v)}>
              <Icon name="bell" size={18} />
              {unreadCount > 0 && <span className="badge-dot" />}
            </button>
            {notifOpen && (
              <div className="notif-dropdown" role="menu">
                <div className="notif-head">
                  <span>Notifications</span>
                  {unreadCount > 0 && <button className="btn text sm" onClick={markAllNotificationsRead}>Mark all read</button>}
                </div>
                {notifications.length === 0 ? (
                  <div className="notif-empty">You're all caught up.</div>
                ) : (
                  <div className="notif-list">
                    {notifications.map((n) => (
                      <button key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`} onClick={() => openNotification(n.id, n.href)}>
                        {!n.read && <span className="notif-dot" />}
                        <div className="notif-body">
                          <div className="notif-title">{n.title}</div>
                          <div className="notif-text">{n.body}</div>
                          <div className="notif-time">{n.time}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="topbar-user">
            <span className="avatar sm" style={{ background: `var(${role.colorVar})` }}>{initials(user.name)}</span>
            <span className="topbar-user-meta">
              <b>{user.name}</b>
              <span>{role.label}</span>
            </span>
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>

      <Copilot />
    </div>
  )
}

function sectionLabel(path: string): string {
  if (path.startsWith('/new-application')) return 'New Application'
  return 'Dashboard'
}

import './Admin.css'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Pill, Toggle, Button, Modal } from '../components/ui'
import { Icon, type IconName } from '../components/ui/icons'
import { useApp } from '../store'
import { ROLES, ROLE_BY_CODE, DEFAULT_ACCESS_BY_ROLE, DATA_ENTITIES, ANALYTICS_SECTIONS } from '../mock/roles'
import { NAV } from '../components/shell/nav'
import type { DataScope, RoleCode, ScreenPermission, User } from '../types'

type AccessMap = Record<string, ScreenPermission>
type FormState = { name: string; email: string; roleCode: RoleCode; region: string; access: AccessMap }
const EMPTY_FORM: FormState = { name: '', email: '', roleCode: 'ase_asm', region: '', access: { ...DEFAULT_ACCESS_BY_ROLE.ase_asm } }

const ADMIN_TABS = [
  { key: 'team', label: 'Team', ic: 'partners' },
  { key: 'access', label: 'Screen access', ic: 'monitor' },
  { key: 'data', label: 'Data access', ic: 'lock' },
  { key: 'sla', label: 'SLA', ic: 'clock' },
  { key: 'settings', label: 'Platform settings', ic: 'settings' },
] as const

// Icon shown in each persona's colored avatar box on the Data access panel.
const ROLE_ICON: Record<RoleCode, IconName> = {
  ase_asm: 'partners',
  asm: 'partners',
  rbl: 'user',
  finance: 'dollar',
  channel_dev: 'wrench',
  mdm: 'shield',
  it: 'monitor',
  leadership: 'analytics',
  admin: 'settings',
}

const DATA_SCOPE_LABEL: Record<DataScope, string> = { all: 'All data', own_region: 'Own region only', own_state: 'Own state only' }
const DATA_SCOPE_HINT: Record<DataScope, string> = {
  all: 'Sees every record, regardless of state.',
  own_region: 'Only records whose state falls in the same macro-region as this persona\'s users.',
  own_state: 'Only records in the exact same state as this persona\'s users — the tightest setting.',
}
type AdminTab = (typeof ADMIN_TABS)[number]['key']

function AccessSummary({ access }: { access?: AccessMap }) {
  const perms = Object.values(access ?? {})
  const viewCount = perms.filter((p) => p.view).length
  const manageCount = perms.filter((p) => p.manage).length
  return (
    <div style={{ display: 'flex', gap: '0.3rem' }}>
      <Pill tone={viewCount ? 'good' : 'neutral'}>{viewCount} view</Pill>
      <Pill tone={manageCount ? 'ai' : 'neutral'}>{manageCount} manage</Pill>
    </div>
  )
}

export function Admin() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<AdminTab>('team')
  const [requireDoc, setRequireDoc] = useState(false)
  const [autoNotify, setAutoNotify] = useState(true)

  const users = useApp((s) => s.users)
  const addUser = useApp((s) => s.addUser)
  const updateUser = useApp((s) => s.updateUser)
  const removeUser = useApp((s) => s.removeUser)
  const moduleAccess = useApp((s) => s.moduleAccess)
  const toggleModuleAccess = useApp((s) => s.toggleModuleAccess)
  const setModuleAccessForRole = useApp((s) => s.setModuleAccessForRole)
  const dataScopeByRole = useApp((s) => s.dataScopeByRole)
  const setDataScopeForRole = useApp((s) => s.setDataScopeForRole)
  const dataEntitiesByRole = useApp((s) => s.dataEntitiesByRole)
  const toggleDataEntity = useApp((s) => s.toggleDataEntity)
  const analyticsSectionsByRole = useApp((s) => s.analyticsSectionsByRole)
  const toggleAnalyticsSection = useApp((s) => s.toggleAnalyticsSection)
  const slaConfig = useApp((s) => s.slaConfig)
  const setSlaConfig = useApp((s) => s.setSlaConfig)
  const slaHours = useApp((s) => s.slaHours)
  const setSlaHours = useApp((s) => s.setSlaHours)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(u: User) {
    setEditingId(u.id)
    setForm({
      name: u.name,
      email: u.email,
      roleCode: u.roleCode,
      region: u.region ?? '',
      access: u.access ?? { ...DEFAULT_ACCESS_BY_ROLE[u.roleCode] },
    })
    setModalOpen(true)
  }

  function changeRole(roleCode: RoleCode) {
    // Resetting to that persona's default permissions keeps the grid honest — an admin who
    // reassigns someone's role sees the permissions that go with it, and can still
    // fine-tune from there before saving.
    setForm({ ...form, roleCode, access: { ...DEFAULT_ACCESS_BY_ROLE[roleCode] } })
  }

  function setPermission(path: string, patch: Partial<ScreenPermission>) {
    const current = form.access[path] ?? { view: false, manage: false }
    const next = { ...current, ...patch }
    // Manage implies View — can't act on a screen you can't open.
    if (next.manage) next.view = true
    setForm({ ...form, access: { ...form.access, [path]: next } })
  }

  function save() {
    if (!form.name.trim() || !form.email.trim()) return
    if (editingId) {
      updateUser(editingId, { ...form })
    } else {
      addUser({ ...form, isActive: true })
    }
    // The sidebar is driven by persona (moduleAccess), not by an individual login — so a
    // screen unticked here has to flow into that persona's visible-screens list too, or the
    // toggle looks like it "saved" but nothing changes when you switch to that persona.
    const visiblePaths = Object.entries(form.access).filter(([, p]) => p.view).map(([path]) => path)
    setModuleAccessForRole(form.roleCode, visiblePaths)
    setModalOpen(false)
  }

  return (
    <div>
      <div className="page-head">
        <h1>Admin &amp; Settings <span className="page-info-ic" title="Manage personas, users and platform-wide behavior. Control who can see what data and how."><Icon name="help" size={13} /></span></h1>
      </div>

      <div className="tabs">
        {ADMIN_TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <Icon name={t.ic} size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'team' && (
        <div className="stack">
          <Card title="Team">
            <div className="row-between" style={{ marginBottom: '0.75rem' }}>
              <p className="muted-note" style={{ margin: 0 }}>
                Everyone with access to the platform, their persona (role), and their per-screen permissions. Only Admins can view or edit this list.
              </p>
              <Button size="sm" onClick={openCreate}>+ Add user</Button>
            </div>
            <div className="dtable-wrap" style={{ border: 'none' }}>
              <table className="dtable">
                <thead><tr><th>Name</th><th>Email</th><th>Persona</th><th>Region</th><th>Access</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="strong">{u.name}</td>
                      <td>{u.email}</td>
                      <td>{ROLE_BY_CODE[u.roleCode]?.label ?? u.roleCode}</td>
                      <td>{u.region ?? '—'}</td>
                      <td><AccessSummary access={u.access} /></td>
                      <td>
                        <button
                          className="pill-btn"
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                          onClick={() => updateUser(u.id, { isActive: !u.isActive })}
                        >
                          <Pill tone={u.isActive ? 'good' : 'neutral'} dot>{u.isActive ? 'Active' : 'Inactive'}</Pill>
                        </button>
                      </td>
                      <td style={{ display: 'flex', gap: '0.5rem' }}>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => removeUser(u.id)}>Remove</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'access' && (
        <div className="stack">
          <Card title="Screen access by persona">
            <p className="muted-note" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
              Which sidebar screens each persona can open, Dashboard included. Untick a screen for a persona and
              it disappears from their sidebar — if they're on it when it's revoked, they're bounced to whichever
              screen is now first on their list (Dashboard is the unavoidable last resort if that leaves them
              with nothing at all — some page always has to render).
            </p>
            <div className="dtable-wrap" style={{ border: 'none', overflowX: 'auto' }}>
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Screen</th>
                    {ROLES.map((r) => <th key={r.code}>{r.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {NAV.flatMap((g) => g.items).map((item) => (
                    <tr key={item.to}>
                      <td className="strong">{item.label}</td>
                      {ROLES.map((r) => {
                        const checked = (moduleAccess[r.code] ?? []).includes(item.to)
                        return (
                          <td key={r.code}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleModuleAccess(r.code, item.to)}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'data' && (
        <div className="stack">
          <div className="da-intro">
            <Card className="da-intro-card">
              <div className="da-intro-body">
                <div className="da-intro-text">
                  <div className="card-title">Data access by persona</div>
                  <p className="da-intro-copy">
                    Control what data each persona can see across regions and states. Set the right scope to ensure
                    data privacy and accuracy.
                  </p>
                </div>
                <div className="da-illustration" aria-hidden="true">
                  <span className="da-illus-lock"><Icon name="lock" size={30} /></span>
                  <span className="da-illus-line da-illus-line-a" />
                  <span className="da-illus-line da-illus-line-b" />
                  <span className="da-illus-user da-illus-user-a"><Icon name="user" size={15} /></span>
                  <span className="da-illus-user da-illus-user-b"><Icon name="user" size={13} /></span>
                </div>
              </div>
            </Card>
            <Card className="da-howitworks-card">
              <div className="da-howitworks">
                <span className="da-howitworks-ic"><Icon name="bulb" size={18} /></span>
                <div>
                  <div className="card-title" style={{ marginBottom: '0.3rem' }}>How it works</div>
                  <p className="da-intro-copy">
                    Row-level access on top of screen access.<br />Set a scope and we'll do the rest.
                  </p>
                  <a href="#" className="da-learn-more" onClick={(e) => e.preventDefault()}>Learn more →</a>
                </div>
              </div>
            </Card>
          </div>

          <Card>
            <div className="da-grid">
              {ROLES.map((r) => {
                const regions = Array.from(new Set(users.filter((u) => u.roleCode === r.code).map((u) => u.region).filter(Boolean)))
                const states = Array.from(new Set(users.filter((u) => u.roleCode === r.code).map((u) => u.state).filter(Boolean)))
                const scope = dataScopeByRole[r.code]
                const entities = dataEntitiesByRole[r.code] ?? []
                const analyticsSections = analyticsSectionsByRole[r.code] ?? []
                return (
                  <div className="da-row" key={r.code} style={{ borderLeft: `4px solid var(${r.colorVar})` }}>
                    <div className="da-persona">
                      <span className="da-persona-ic" style={{
                        background: `color-mix(in srgb, var(${r.colorVar}) 14%, transparent)`,
                        color: `var(${r.colorVar})`,
                      }}><Icon name={ROLE_ICON[r.code]} size={24} /></span>
                      <div>
                        <div className="strong">{r.label}</div>
                        <div className="da-persona-status"><span className="d" style={{ background: 'var(--good)' }} />Active</div>
                        <div className="muted-note" style={{ margin: 0 }}>
                          {regions.length ? `Region: ${regions.join(', ')}` : 'No region set'}
                          {states.length ? ` · State: ${states.join(', ')}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="da-scope">
                      {(['all', 'own_region', 'own_state'] as DataScope[]).map((s) => (
                        <label key={s} className={`da-scope-opt ${scope === s ? 'on' : ''}`}>
                          <input type="radio" name={`scope-${r.code}`} checked={scope === s}
                            onChange={() => setDataScopeForRole(r.code, s)} />
                          <span className="da-scope-label">{DATA_SCOPE_LABEL[s]}</span>
                          <span className="da-scope-hint">{DATA_SCOPE_HINT[s]}</span>
                        </label>
                      ))}
                    </div>

                    <div className="da-entities">
                      <div className="da-entities-label">Applies to</div>
                      {DATA_ENTITIES.map((e) => (
                        <label key={e.key} className={`da-entity-opt ${scope === 'all' ? 'locked' : ''}`}>
                          <input type="checkbox" checked={scope === 'all' || entities.includes(e.key)}
                            readOnly={scope === 'all'}
                            onChange={() => scope !== 'all' && toggleDataEntity(r.code, e.key)} />
                          <span>{e.label}</span>
                        </label>
                      ))}
                    </div>

                    <div className="da-entities">
                      <div className="da-entities-label" title="Which of Analytics' own tabs this persona can see — independent of the row-scoping above.">
                        Analytics tabs
                      </div>
                      {ANALYTICS_SECTIONS.map((sec) => (
                        <label key={sec.key} className="da-entity-opt">
                          <input type="checkbox" checked={analyticsSections.includes(sec.key)}
                            onChange={() => toggleAnalyticsSection(r.code, sec.key)} />
                          <span>{sec.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="da-foot">
              <p className="da-foot-note">
                <Icon name="info" size={14} /> Changes are auto-saved and applied in real time.
              </p>
              <Button size="sm" onClick={() => navigate('/audit-log')}>
                <Icon name="list" size={14} /> Audit History
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'sla' && (
        <div className="stack">
          <Card title="SLA configuration">
            <p className="muted-note" style={{ marginTop: 0 }}>Day-based SLAs are counted in <b>working days</b>, anchored to <b>Day D</b> (the day the 30-day termination notice is served/received) — per the deck. Change a value and it applies across the app.</p>
            <div className="sla-cfg">
              <label className="sla-cfg-row">
                <div><b>Scouting completion</b><span>Complete shortlisting within N working days of Day D (deck slide 4 — “within 7 days”).</span></div>
                <div className="sla-cfg-input">Day D +<input type="number" min={1} max={30} value={slaConfig.scoutingDays} onChange={(e) => setSlaConfig({ scoutingDays: Math.max(1, +e.target.value || 1) })} />days</div>
              </label>
              <label className="sla-cfg-row">
                <div><b>Approvals due</b><span>Recommendation + L1/L2 approvals land by Day D + N working days (deck slide 7 — “Day D”).</span></div>
                <div className="sla-cfg-input">Day D +<input type="number" min={0} max={10} value={slaConfig.approvalDays} onChange={(e) => setSlaConfig({ approvalDays: Math.max(0, +e.target.value || 0) })} />days</div>
              </label>
              <label className="sla-cfg-row">
                <div><b>IT code creation</b><span>IT creates the system code by Day D + N working days (deck slide 7 — “D+2”).</span></div>
                <div className="sla-cfg-input">Day D +<input type="number" min={1} max={10} value={slaConfig.itCodeDays} onChange={(e) => setSlaConfig({ itCodeDays: Math.max(1, +e.target.value || 1) })} />days</div>
              </label>
              <label className="sla-cfg-row">
                <div><b>Review window</b><span>Hours a newly flagged/routed case gets before it counts as overdue.</span></div>
                <div className="sla-cfg-input"><input type="number" min={1} max={168} value={slaHours} onChange={(e) => setSlaHours(Math.max(1, +e.target.value || 1))} />hours</div>
              </label>
            </div>
          </Card>
        </div>
      )}

      {tab === 'settings' && (
        <div className="stack">
          <Card title="Platform settings">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="row-between">
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>Require Document Intelligence for all Vendor onboarding</div>
                  <div className="muted-note">{requireDoc ? 'On — enforced for every Vendor case' : 'Off — left to MDM\'s discretion per case'}</div>
                </div>
                <Toggle on={requireDoc} onChange={setRequireDoc} />
              </div>
              <div className="row-between">
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>Auto-notify on SLA breach</div>
                  <div className="muted-note">{autoNotify ? 'On — Routing & Compliance Agent alerts the owner immediately' : 'Off'}</div>
                </div>
                <Toggle on={autoNotify} onChange={setAutoNotify} />
              </div>
            </div>
          </Card>
          <p className="muted-note">Partner types and their documents/workflow are configured in Templates, not here.</p>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit user' : 'Add user'} size="lg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="u-name">Name</label>
              <input id="u-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="u-email">Email</label>
              <input id="u-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="u-role">Persona (role)</label>
              <select id="u-role" className="input" value={form.roleCode} onChange={(e) => changeRole(e.target.value as RoleCode)}>
                {ROLES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="u-region">Region</label>
              <input id="u-region" className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            </div>
          </div>

          <div className="field">
            <label>Permissions</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
              {NAV.flatMap((g) => g.items).map((item) => {
                const perm = form.access[item.to] ?? { view: false, manage: false }
                return (
                  <div key={item.to} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '0.75rem 0.9rem', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.65rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <Icon name={item.ic} size={16} /> {item.label}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <Toggle on={perm.view} onChange={(v) => setPermission(item.to, { view: v, manage: v ? perm.manage : false })} label="View" />
                      <Toggle on={perm.manage} onChange={(v) => setPermission(item.to, { manage: v })} label="Manage" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="row-between" style={{ marginTop: '0.5rem' }}>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editingId ? 'Save changes' : 'Add user'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

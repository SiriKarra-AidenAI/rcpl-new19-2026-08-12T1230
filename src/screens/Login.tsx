import './Login.css'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui'
import { BrandMark } from '../components/BrandMark'
import { ROLES, DEMO_USERS } from '../mock/roles'
import { useApp } from '../store'
import type { RoleCode } from '../types'

// The agent pipeline shown in the hero — each stage lights up in sequence.
const PIPELINE: { name: string; sub: string; rt: string }[] = [
  { name: 'Intake Agent', sub: 'parses & de-dupes applications', rt: '77ms' },
  { name: 'Recommendation Engine', sub: 'ranks candidates by fit', rt: '92ms' },
  { name: 'Evaluation Agent', sub: 'scores against policy matrix', rt: '61ms' },
  { name: 'Routing & Compliance', sub: 'flags & routes edge cases', rt: '48ms' },
  { name: 'Communication Agent', sub: 'drafts partner comms', rt: '55ms' },
]

const HERO_STATS: [string, string][] = [
  ['6', 'live agents'],
  ['9.1×', 'faster intake'],
  ['100%', 'audit trail'],
]

function AgentPipeline() {
  return (
    <div className="pipe" aria-hidden>
      <div className="pipe-head">
        <span className="pipe-live"><span className="dot" /> ORCHESTRATION</span>
        <span className="pipe-meta">6 agents · streaming</span>
      </div>
      <div className="pipe-rail">
        {PIPELINE.map((a, i) => (
          <div className="pipe-node" key={a.name} style={{ animationDelay: `${0.25 + i * 0.16}s` }}>
            <span className="pipe-glyph"><span className="pulse" style={{ animationDelay: `${i * 0.4}s` }} /></span>
            <span className="pipe-body">
              <span className="pipe-name">{a.name}</span>
              <span className="pipe-sub">{a.sub}</span>
            </span>
            <span className="pipe-rt">{a.rt}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Matches the seed password in backend/users.py — rotate both together.
const DEMO_PASSWORD = 'Rcpl@2026'

// Quick test logins — two distinct ASEs and two distinct ASMs (real accounts, not just the
// persona switcher) so you can log in as one, assign/reassign a DB to the other in the DB Pool,
// then log back in as THAT person and see it show up in their own "assigned to me" — the two
// people actually resolve to different identities now (see store.ts's useMe()), not the same
// hardcoded per-role representative.
const QUICK_LOGINS: { label: string; email: string }[] = [
  { label: 'ASE — R. Malhotra', email: 'r.malhotra@rcpl.in' },
  { label: 'ASE — K. Bhosale', email: 'k.bhosale@rcpl.in' },
  { label: 'ASM — D. Kulkarni', email: 'd.kulkarni@rcpl.in' },
  { label: 'ASM — S. Patil', email: 's.patil@rcpl.in' },
]

export function Login() {
  const login = useApp((s) => s.login)
  const navigate = useNavigate()

  const [role, setRole] = useState<RoleCode>('ase_asm')
  const [email, setEmail] = useState(DEMO_USERS.ase_asm.email)
  const [password, setPassword] = useState(DEMO_PASSWORD)
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const pickRole = (r: RoleCode) => {
    setRole(r)
    setEmail(DEMO_USERS[r].email)
    setPassword(DEMO_PASSWORD)
    setError(null)
  }

  const attemptLogin = async (loginEmail: string, loginPassword: string) => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.detail ?? 'Sign-in failed — check your email and password.')
        setLoading(false)
        return
      }
      const data = await res.json()
      login({ token: data.access_token, user: data.user })
      navigate('/dashboard')
    } catch {
      setError('Can\'t reach the authentication service — make sure the backend is running on port 8788.')
      setLoading(false)
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password.trim()) { setError('Enter your email and password to continue.'); return }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('That doesn\'t look like a valid email address.'); return }
    attemptLogin(email, password)
  }

  // Selecting a name signs straight in as that real account — no retyping credentials each time
  // you want to switch between two ASEs (or two ASMs) to check an assign/reassign from both sides.
  const quickLogin = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chosenEmail = e.target.value
    e.target.value = ''
    if (chosenEmail) attemptLogin(chosenEmail, DEMO_PASSWORD)
  }

  return (
    <div className="login-wrap">
      <aside className="login-aside">
        <div className="aside-aurora" aria-hidden />
        <div className="aside-grid" aria-hidden />

        <div className="aside-top">
          <div className="login-brand"><BrandMark /></div>
          <span className="aside-badge">AIDENAI × RCPL</span>
        </div>

        <div className="aside-mid">
          <span className="aside-eyebrow"><span className="dot" /> Agentic operations platform</span>
          <h2>Distributor onboarding,<br /><span className="ai-grad">run by agents.</span></h2>
          <p className="lede">One templatized workspace where AI agents rank candidates, run the
            approval matrix, route flagged cases, and answer questions — while your team stays in control.</p>
          <AgentPipeline />
        </div>

        <div className="aside-bottom">
          <div className="hero-stats">
            {HERO_STATS.map(([v, l]) => (
              <div className="hero-stat" key={l}>
                <span className="hs-v">{v}</span>
                <span className="hs-l">{l}</span>
              </div>
            ))}
          </div>
          <div className="login-foot">PROTOTYPE · SIMULATED AGENTS · STAPLES DIVISION</div>
        </div>
      </aside>

      <main className="login-main">
        <form className="login-card" onSubmit={submit} noValidate>
          <div className="login-logo-sm"><BrandMark variant="full" /></div>
          <div className="eyebrow">Welcome back</div>
          <h1>Sign in to your workspace</h1>
          <p className="sub">Use your RCPL credentials — pick a demo persona below to prefill one.</p>

          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" className="input" type="email" autoComplete="username" value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null) }} placeholder="you@rcpl.in" />
          </div>

          <div className="field">
            <label htmlFor="pw">Password</label>
            <div className="pw-wrap">
              <input id="pw" className="input" type={showPw ? 'text' : 'password'} autoComplete="current-password"
                value={password} onChange={(e) => { setPassword(e.target.value); setError(null) }} placeholder="••••••••" />
              <button type="button" className="pw-toggle" onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
            </div>
          </div>

          {error && <div className="login-error" role="alert">{error}</div>}

          <div className="login-meta">
            <label className="remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me
            </label>
            <a href="#" onClick={(e) => e.preventDefault()}>Forgot password?</a>
          </div>

          <Button type="submit" disabled={loading} className="login-submit">
            {loading ? 'Signing in…' : `Sign in as ${ROLES.find((r) => r.code === role)?.label} →`}
          </Button>

          <div className="login-divider"><span>Quick test login — check assign/reassign as either side</span></div>
          <select className="input quick-login-select" defaultValue="" onChange={quickLogin} disabled={loading}
            title="Sign straight in as one of two ASEs or two ASMs">
            <option value="" disabled>Sign in as…</option>
            <optgroup label="ASE">
              {QUICK_LOGINS.filter((q) => q.label.startsWith('ASE')).map((q) => <option key={q.email} value={q.email}>{q.label}</option>)}
            </optgroup>
            <optgroup label="ASM">
              {QUICK_LOGINS.filter((q) => q.label.startsWith('ASM')).map((q) => <option key={q.email} value={q.email}>{q.label}</option>)}
            </optgroup>
          </select>

          <div className="login-divider"><span>Demo access — sign in as</span></div>
          <div className="demo-chips">
            {ROLES.map((r) => (
              <button key={r.code} type="button" className={`demo-chip ${role === r.code ? 'sel' : ''}`} onClick={() => pickRole(r.code)}>
                <span className="cd" style={{ background: `var(${r.colorVar})` }} />{r.label}
              </button>
            ))}
          </div>
        </form>
      </main>
    </div>
  )
}

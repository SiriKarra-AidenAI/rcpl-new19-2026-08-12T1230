import { Link } from 'react-router-dom'
import { Card, Pill, Button, AgentBadge } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { AGENTS } from '../mock/agents'
import { useApp } from '../store'

export function Agents() {
  const setCopilotAgent = useApp((s) => s.setCopilotAgent)
  const setCopilotOpen = useApp((s) => s.setCopilotOpen)

  return (
    <div>
      <div className="page-head">
        <h1>AI Agents <span className="page-info-ic" title="Every specialist agent working this platform — what it does, where it acts, and what it's done recently."><Icon name="help" size={13} /></span></h1>
      </div>

      <div className="stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
        {AGENTS.map((a) => (
          <Card key={a.id}>
            <div className="row-between" style={{ alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <span
                  style={{
                    width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center',
                    background: `color-mix(in srgb, var(${a.colorVar}) 16%, transparent)`, color: `var(${a.colorVar})`,
                  }}
                >
                  <Icon name={a.icon} size={17} />
                </span>
                <div>
                  <div className="strong" style={{ fontSize: '0.94rem' }}>{a.label}</div>
                  <Pill tone={a.status === 'active' ? 'ai' : 'neutral'} dot>{a.status === 'active' ? 'Active' : 'Standby'}</Pill>
                </div>
              </div>
              <AgentBadge solid>AI</AgentBadge>
            </div>

            <p style={{ margin: '0.75rem 0 0.4rem' }}>{a.tagline}</p>
            <p className="muted-note" style={{ margin: 0 }}>{a.detail}</p>

            <div style={{ margin: '0.85rem 0' }}>
              <div className="muted-note" style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Recent activity</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {a.recentActivity.map((line) => (
                  <li key={line} className="muted-note">{line}</li>
                ))}
              </ul>
            </div>

            <div className="row-between">
              <Link to={a.homeRoute}><Button size="sm" variant="ghost">{a.homeLabel}</Button></Link>
              {a.copilotAgent && (
                <Button
                  size="sm"
                  onClick={() => { setCopilotAgent(a.copilotAgent!); setCopilotOpen(true) }}
                >
                  Ask this agent
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

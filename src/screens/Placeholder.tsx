import { Card } from '../components/ui'
import { Icon } from '../components/ui/icons'

/** Temporary module scaffold — real module screens land in later build steps. */
export function Placeholder({ title, blurb, bullets }: { title: string; blurb: string; bullets: string[] }) {
  return (
    <div>
      <div className="page-head">
        <h1>{title} <span className="page-info-ic" title={blurb}><Icon name="help" size={13} /></span></h1>
      </div>
      <Card title="Planned for this module">
        <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--ink-soft)', fontSize: '0.9rem', lineHeight: 1.8 }}>
          {bullets.map((b) => <li key={b}>{b}</li>)}
        </ul>
        <p style={{ marginTop: '0.9rem', fontSize: '0.8rem', color: 'var(--ink-mute)' }}>
          Prototype in progress — this module is being built out. The Dashboard and Copilot are live now.
        </p>
      </Card>
    </div>
  )
}

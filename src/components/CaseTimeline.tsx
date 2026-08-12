import './CaseTimeline.css'
import { Icon } from './ui/icons'
import type { IconName } from './ui/icons'
import type { CaseEvent } from '../types'

const KIND_ICON: Record<CaseEvent['kind'], IconName> = {
  created: 'new',
  assigned: 'user',
  reassigned: 'user',
  transition: 'chevronRight',
  escalated: 'alert',
  sla_due_soon: 'clock',
  sla_breach: 'clock',
  note: 'comms',
  approved: 'check',
  rejected: 'close',
}

const KIND_TONE: Record<CaseEvent['kind'], string> = {
  created: 'neutral',
  assigned: 'ai',
  reassigned: 'warn',
  transition: 'neutral',
  escalated: 'crit',
  sla_due_soon: 'warn',
  sla_breach: 'crit',
  note: 'neutral',
  approved: 'good',
  rejected: 'crit',
}

/** Renders any case's append-only history as a chronological timeline. Newest first. */
export function CaseTimeline({ events, empty = 'No activity yet.' }: { events?: CaseEvent[]; empty?: string }) {
  if (!events || events.length === 0) return <div className="ctl-empty">{empty}</div>
  const ordered = [...events].sort((a, b) => b.at - a.at)
  return (
    <ol className="ctl">
      {ordered.map((e) => (
        <li className={`ctl-row tone-${KIND_TONE[e.kind]}`} key={e.id}>
          <span className="ctl-dot"><Icon name={KIND_ICON[e.kind]} size={12} /></span>
          <div className="ctl-body">
            <div className="ctl-summary">{e.summary}</div>
            <div className="ctl-meta">{e.actor} · {e.when}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

import './Copilot.css'
import { useEffect, useMemo, useState } from 'react'
import { AgentBadge, AiText, StreamingText } from '../ui'
import { Icon } from '../ui/icons'
import { answerFor, suggestedPrompts } from '../../lib/copilot'
import { useApp } from '../../store'

interface Turn { role: 'user' | 'ai'; text: string }
const COPILOT_LABEL = 'Copilot'

export function Copilot() {
  const open = useApp((s) => s.copilotOpen)
  const setOpen = useApp((s) => s.setCopilotOpen)
  // copilotAgent still exists on the store so other screens can deep-link into a topic,
  // but the copilot itself is one generalist — it answers anything in scope, no picker.
  const agent = useApp((s) => s.copilotAgent)
  const role = useApp((s) => s.viewingAs) ?? 'ase_asm'

  const [turns, setTurns] = useState<Turn[]>([
    { role: 'ai', text: 'Hi — I\'m your Copilot. Ask me about any case (try CMP-2291), distributor, territory, document, approval or metric — or just say "catch me up on today".' },
  ])

  const suggestions = useMemo(() => suggestedPrompts(agent, role), [agent, role])

  const ask = (q: string) => {
    if (!q.trim()) return
    setTurns((t) => [...t, { role: 'user', text: q }, { role: 'ai', text: answerFor(agent, q) }])
  }

  // Questions queued from other screens (e.g. the dashboard's "View full insight").
  const pendingAsk = useApp((s) => s.copilotAsk)
  const clearAsk = useApp((s) => s.clearCopilotAsk)
  useEffect(() => {
    if (!pendingAsk) return
    ask(pendingAsk)
    clearAsk()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk])

  if (!open) {
    return (
      <button className="copilot-fab" onClick={() => setOpen(true)} title="Ask the Copilot" aria-label="Ask the Copilot">
        <Icon name="spark" size={24} />
      </button>
    )
  }

  return (
    <aside className="copilot-rail" role="complementary" aria-label="Copilot">
      <div className="copilot-head">
        <AgentBadge solid>AI</AgentBadge>
        <span className="title">{COPILOT_LABEL}</span>
        <button className="x" onClick={() => setOpen(false)} aria-label="Close copilot">✕</button>
      </div>

      <div className="copilot-body">
        {turns.map((t, i) => (
          <div key={i} className={`msg ${t.role}`}>
            {t.role === 'ai' && <div className="who"><AgentBadge>AI</AgentBadge> {COPILOT_LABEL}</div>}
            {t.role === 'ai'
              ? (i === turns.length - 1 ? <StreamingText text={t.text} /> : <AiText text={t.text} />)
              : t.text}
          </div>
        ))}
      </div>

      <div className="copilot-suggest">
        {suggestions.map((s) => (
          <button key={s} onClick={() => ask(s)}>{s}</button>
        ))}
      </div>

      <CopilotInput onSend={ask} />
    </aside>
  )
}

function CopilotInput({ onSend }: { onSend: (q: string) => void }) {
  const [v, setV] = useState('')
  return (
    <form
      className="copilot-input"
      onSubmit={(e) => { e.preventDefault(); onSend(v); setV('') }}
    >
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Ask the copilot…" aria-label="Ask the copilot" />
      <button className="btn primary sm" type="submit">Send</button>
    </form>
  )
}

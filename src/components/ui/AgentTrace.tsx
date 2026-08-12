import './ui.css'
import { useEffect, useRef, useState } from 'react'

export interface TraceLine {
  text: string
  tone?: 'ok' | 'bad' | 'muted' | 'accent'
}

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Reveals reasoning-trace lines one at a time (terminal style) to convey an
 * agent "thinking". Deterministic; honors prefers-reduced-motion.
 */
export function AgentTrace({ lines, lineDelay = 620, onDone }:
  { lines: TraceLine[]; lineDelay?: number; onDone?: () => void }) {
  const [count, setCount] = useState(0)
  const doneRef = useRef(false)

  useEffect(() => {
    setCount(0)
    doneRef.current = false
    if (reduced()) {
      setCount(lines.length)
      onDone?.()
      return
    }
    const t = setInterval(() => {
      setCount((c) => {
        const next = c + 1
        if (next >= lines.length) {
          clearInterval(t)
          if (!doneRef.current) { doneRef.current = true; onDone?.() }
        }
        return Math.min(next, lines.length)
      })
    }, lineDelay)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, lineDelay])

  const streaming = count < lines.length
  return (
    <div className="trace" role="log" aria-live="polite">
      {lines.slice(0, count).map((l, i) => (
        <div key={i} className={l.tone ?? ''}>{l.text}</div>
      ))}
      {streaming && <span className="caret">&nbsp;</span>}
    </div>
  )
}

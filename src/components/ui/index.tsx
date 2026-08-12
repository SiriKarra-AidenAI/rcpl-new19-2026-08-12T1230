import './ui.css'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStreamingText } from '../../lib/useStreamingText'

/* ---- Button ---- */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'text'
  size?: 'md' | 'sm'
}
export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: ButtonProps) {
  return <button className={`btn ${variant} ${size === 'sm' ? 'sm' : ''} ${className}`} {...rest} />
}

/* ---- Pill ---- */
type Tone = 'good' | 'warn' | 'crit' | 'ai' | 'neutral'
export function Pill({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`pill ${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  )
}

/* ---- Confidence pill ---- */
export function ConfidencePill({ pct }: { pct: number }) {
  return (
    <span className="conf" title={`Model confidence: ${pct}%`}>
      <span className="bar"><i style={{ width: `${pct}%` }} /></span>
      <span className="val">{pct}%</span>
      <span className="cap">confidence</span>
    </span>
  )
}

/* ---- Card ---- */
export function Card({ title, children, className = '', padLg }: { title?: string; children: ReactNode; className?: string; padLg?: boolean }) {
  return (
    <div className={`card ${padLg ? 'pad-lg' : ''} ${className}`}>
      {title && <div className="card-title">{title}</div>}
      {children}
    </div>
  )
}

/* ---- Toggle ---- */
export function Toggle({ on, onChange, label, disabled, title }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''} ${disabled ? 'disabled' : ''}`} disabled={disabled}
      onClick={() => !disabled && onChange(!on)} aria-pressed={on} title={title}
      style={{ background: 'none', border: 'none', padding: 0, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span className="sw"><i /></span>
      {label}
    </button>
  )
}

/* ---- Agent badge ---- */
export function AgentBadge({ children = 'AI', solid }: { children?: ReactNode; solid?: boolean }) {
  return <span className={`agent-badge ${solid ? 'solid' : ''}`}>{children}</span>
}

/* ---- Modal ---- */
export function Modal({ open, onClose, title, children, size }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; size?: 'md' | 'lg' }) {
  if (!open) return null
  return createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className={`modal ${size === 'lg' ? 'lg' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="title">{title}</span>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/* ---- Streaming prose (typewriter) ---- */
// Turns "• " bullet lines and \n breaks into real hanging-indent list rows instead of
// leaving them as a flat string that CSS white-space:pre-line can't align properly.
// Each non-bullet line becomes its own paragraph (real margin between them, not a bare <br>),
// and consecutive bullet lines group into one list block — so a reply with a headline, a
// bulleted list and a closing line reads as three visually distinct sections, not one run-on wall.
export function formatAiText(text: string): ReactNode[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  const nodes: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const bullet = lines[i].match(/^• (.*)$/)
    if (bullet) {
      const group: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^• (.*)$/)
        if (!m) break
        group.push(m[1])
        i++
      }
      nodes.push(
        <div className="ai-bullets" key={`g${nodes.length}`}>
          {group.map((g, gi) => (
            <div className="ai-bullet" key={gi}>
              <span className="ai-bullet-dot" aria-hidden>•</span>
              <span className="ai-bullet-body">{g}</span>
            </div>
          ))}
        </div>,
      )
    } else {
      nodes.push(<p className="ai-para" key={`p${nodes.length}`}>{lines[i]}</p>)
      i++
    }
  }
  return nodes
}

export function AiText({ text }: { text: string }) {
  return <>{formatAiText(text)}</>
}

// formatAiText's output is block-level (<p>/<div> per line or bullet group), so the wrapper
// tag defaults to 'div' — wrapping block content in an inline 'span' is invalid HTML and lets
// browsers silently mangle the layout.
export function StreamingText({ text, speed, chunk, start = true, as: Tag = 'div' }:
  { text: string; speed?: number; chunk?: number; start?: boolean; as?: 'span' | 'p' | 'div' }) {
  const { text: shown, done } = useStreamingText(text, { speed, chunk, start })
  return (
    <Tag>
      {formatAiText(shown)}
      {!done && <span className="stream-caret" aria-hidden />}
    </Tag>
  )
}

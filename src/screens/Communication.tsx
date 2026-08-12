import './Communication.css'
import { useState } from 'react'
import { Card, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { ROLE_BY_CODE, DEMO_USERS } from '../mock/roles'
import { useApp } from '../store'
import { EXTRACTIONS } from '../mock/intake'
import type { CaseMessage } from '../types'

// Standard DB document checklist — used when a thread has no live intake link to read the real
// missing set from, so "Request documents" still drafts a sensible ask.
const STANDARD_DOCS = ['GST Certificate', 'FSSAI License', 'Godown Proof', 'PAN Card', 'Cancelled Cheque', 'DB Onboarding Form']

function Avatar({ roleCode, name }: { roleCode: CaseMessage['authorRole']; name: string }) {
  const r = ROLE_BY_CODE[roleCode]
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('')
  return <span className="avatar" style={{ background: `var(${r.colorVar})` }}>{initials}</span>
}

export function Communication() {
  const threads = useApp((s) => s.commThreads)
  const selectedCode = useApp((s) => s.selectedThreadCode)
  const setSelectedCode = useApp((s) => s.setSelectedThreadCode)
  const sendCommMessage = useApp((s) => s.sendCommMessage)
  const flaggedCases = useApp((s) => s.flaggedCases)
  const candidates = useApp((s) => s.candidates)
  const logAudit = useApp((s) => s.logAudit)
  const [draft, setDraft] = useState('')
  const [drafted, setDrafted] = useState(false)
  const viewingAs = useApp((s) => s.viewingAs) ?? 'ase_asm'
  const thread = threads.find((t) => t.code === selectedCode) ?? threads[0]
  const nextReplier = thread.participants.find((m) => m.isNextReplier)

  // Link the thread → case → candidate → its intake extraction, so we can read the REAL set of
  // documents still outstanding. Falls back to the standard checklist when there's no live link.
  const linkedCase = flaggedCases.find((c) => c.code === thread.code)
  const linkedCandidate = linkedCase?.candidateId ? candidates.find((x) => x.id === linkedCase.candidateId) : undefined
  const ext = linkedCandidate?.sourceIntakeId ? EXTRACTIONS[linkedCandidate.sourceIntakeId] : undefined
  const missingDocs = ext?.documents?.filter((d) => !d.received).map((d) => d.name) ?? []
  const requestable = missingDocs.length ? missingDocs : STANDARD_DOCS

  // Communication Agent drafts, the human sends — these prefill the compose box.
  const bullet = (items: string[]) => items.map((d) => `• ${d}`).join('\n')
  const DRAFTS = {
    docs: `Hi ${thread.partnerName} team,\n\nTo move your application (${thread.code}) forward, could you please share the following pending document(s):\n${bullet(requestable)}\n\nJust reply here with them attached and we'll take it from there. Thank you!`,
    reminder: `Hi ${thread.partnerName} team,\n\nA gentle reminder on ${thread.code} — we're waiting to hear back so we can proceed. Let us know if there's anything you need from our side.`,
    update: `Hi ${thread.partnerName} team,\n\nCould you share a quick status update on ${thread.code}? Happy to help if anything is blocking progress.`,
  }
  const applyDraft = (text: string) => { setDraft(text); setDrafted(true) }

  const send = () => {
    const body = draft.trim()
    if (!body) return
    const me = DEMO_USERS[viewingAs]
    sendCommMessage(thread.code, { id: `n${Date.now()}`, authorRole: viewingAs, authorName: me.name, body })
    if (drafted) logAudit({ actor: me.name, kind: 'human', action: `Sent a Communication Agent-drafted request on ${thread.code}`, entity: thread.code })
    setDraft('')
    setDrafted(false)
  }

  return (
    <div>
      <div className="page-head">
        <h1>Communication <span className="page-info-ic" title="Threaded, case-level discussion powered by the Communication Agent — internal team threads and outbound partner nudges live side by side, and it auto-notifies whoever needs to reply next."><Icon name="help" size={13} /></span></h1>
      </div>

      <div className="comm-layout">
        <div className="thread-list">
          {threads.map((t) => (
            <button key={t.code} className={`thread-item ${selectedCode === t.code ? 'sel' : ''}`} onClick={() => setSelectedCode(t.code)}>
              <div className="ti-top">
                <span className="ti-code">{t.code}</span>
                <span style={{ fontSize: '0.74rem', color: 'var(--ink-mute)' }}>{t.town}</span>
                <span className="avatar-stack" style={{ marginLeft: 'auto' }}>
                  {t.participants.slice(-3).map((m) => <Avatar key={m.id} roleCode={m.authorRole} name={m.authorName} />)}
                </span>
              </div>
              <div className="ti-partner">{t.partnerName} {t.audience === 'partner' && <Pill tone="ai">Partner email</Pill>}</div>
              <div className="ti-preview">{t.last}</div>
            </button>
          ))}
        </div>

        <Card>
          <div className="thread-head">
            <div>
              <span className="ti-code" style={{ fontSize: '0.85rem' }}>{thread.code}</span> · {thread.partnerName}, {thread.town}
            </div>
            <Pill tone="ai" dot>Communication Agent</Pill>
          </div>

          {thread.audience === 'partner' && (
            <div className="notify-bar" style={{ marginBottom: '0.8rem' }}>
              <Icon name="send" size={14} /> This is an outbound email thread to <strong style={{ margin: '0 0.25rem' }}>{thread.partnerName}</strong> — not the internal case discussion.
            </div>
          )}

          <div className="msg-list">
            {thread.participants.map((m) => (
              <div className="msg-item" key={m.id}>
                <Avatar roleCode={m.authorRole} name={m.authorName} />
                <div className="bubble">
                  <div className="m-who">{m.authorName} <span style={{ color: 'var(--ink-mute)', fontWeight: 500, fontSize: '0.72rem' }}>· {ROLE_BY_CODE[m.authorRole].label}</span></div>
                  <div className="m-body">{m.body}</div>
                </div>
              </div>
            ))}
          </div>

          {nextReplier && (
            <div className="notify-bar">
              <Icon name="spark" size={14} />
              Communication Agent notified <strong style={{ margin: '0 0.25rem' }}>{ROLE_BY_CODE[nextReplier.authorRole].label}</strong> — expected to reply next.
            </div>
          )}

          {missingDocs.length > 0 && (
            <div className="comm-missing">
              <Icon name="alert" size={14} />
              <span><strong>{missingDocs.length} document{missingDocs.length > 1 ? 's' : ''} still missing:</strong> {missingDocs.join(', ')}</span>
              <button className="comm-missing-cta" onClick={() => applyDraft(DRAFTS.docs)}>Request {missingDocs.length > 1 ? 'them' : 'it'} →</button>
            </div>
          )}

          <div className="comm-qa">
            <span className="comm-qa-lbl"><Icon name="spark" size={12} /> Agent can draft:</span>
            <button className="comm-qa-chip" onClick={() => applyDraft(DRAFTS.docs)}>
              <Icon name="documents" size={12} /> Request {missingDocs.length ? `${missingDocs.length} missing doc${missingDocs.length > 1 ? 's' : ''}` : 'documents'}
            </button>
            <button className="comm-qa-chip" onClick={() => applyDraft(DRAFTS.reminder)}><Icon name="clock" size={12} /> Send reminder</button>
            <button className="comm-qa-chip" onClick={() => applyDraft(DRAFTS.update)}><Icon name="comms" size={12} /> Request update</button>
          </div>

          <form className="comm-compose" onSubmit={(e) => { e.preventDefault(); send() }}>
            <textarea placeholder={thread.audience === 'partner' ? `Email ${thread.partnerName}…` : 'Reply in this case thread…'} aria-label="Reply"
              rows={Math.min(8, Math.max(1, draft.split('\n').length))}
              value={draft} onChange={(e) => { setDraft(e.target.value); setDrafted(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }} />
            <button className="btn primary sm" type="submit" disabled={!draft.trim()}>Send</button>
          </form>
          {drafted && <div className="comm-drafted"><Icon name="spark" size={11} /> Drafted by Communication Agent — review and send, or edit first.</div>}
        </Card>
      </div>
    </div>
  )
}

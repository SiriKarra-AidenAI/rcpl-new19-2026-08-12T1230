import { Button, Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { useApp } from '../store'
import type { ReportItem } from '../store'

// Prototype export — produces a real downloadable file so "share or export" actually works.
function downloadReport(r: ReportItem) {
  const body = [
    'RCPL — Reliance Consumer Products',
    `Report: ${r.name}`,
    `Generated: ${r.date}`,
    `Format: ${r.format}`,
    '',
    '(Prototype export — in the live platform this is the full formatted document.)',
  ].join('\n')
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${r.name.replace(/[^a-z0-9]+/gi, '_')}.${r.format === 'Excel' ? 'csv' : 'txt'}`
  a.click()
  URL.revokeObjectURL(url)
}

export function Reports() {
  const reports = useApp((s) => s.reports)
  const addReport = useApp((s) => s.addReport)
  const generate = () => addReport({ name: 'Coverage & AI-performance snapshot', format: 'PDF' })

  return (
    <div>
      <div className="page-head">
        <h1>Reports <span className="page-info-ic" title="Export any analytics view as a shareable report for leadership."><Icon name="help" size={13} /></span></h1>
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <Button onClick={generate}><Icon name="spark" size={14} /> Generate new report</Button>
      </div>
      <div className="dtable-wrap">
        <table className="dtable">
          <thead><tr><th>Report</th><th>Generated</th><th>Format</th><th></th></tr></thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td className="strong">{r.name}</td>
                <td className="num">{r.date}</td>
                <td><Pill tone="neutral">{r.format}</Pill></td>
                <td><button className="btn text sm" style={{ color: 'var(--ai-text)', fontWeight: 700 }} onClick={() => downloadReport(r)}>Download</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

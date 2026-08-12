import './Templates.css'
import { Fragment } from 'react'
import { Pill } from '../components/ui'
import { Icon } from '../components/ui/icons'
import { PARTNER_TYPE_COLOR, PARTNER_TYPES } from '../mock/templates'

export function Templates() {
  return (
    <div>
      <div className="page-head">
        <h1>Templates <span className="page-info-ic" title="The configuration layer: partner type → required documents → approval workflow. Adding a new partner type is a new row here, not a new build."><Icon name="help" size={13} /></span></h1>
      </div>

      <div className="tpl-note">
        <strong>Templatized from day one.</strong> Distributor and Vendor are configured today. Selecting a type in
        New Application applies its documents and workflow automatically — Logistics and Co-packer reuse the same engine
        when RCPL is ready.
      </div>

      <div className="tpl-list">
        {PARTNER_TYPES.map((t) => (
          <div key={t.code} className={`tpl-card ${!t.isActive ? 'soon' : ''}`}>
            <div className="tpl-head">
              <span className="mk" style={{ background: PARTNER_TYPE_COLOR[t.code] }}>{t.label[0]}</span>
              <span className="nm">{t.label}</span>
              {t.isActive ? <Pill tone="good">Configured</Pill> : <Pill tone="warn">Coming soon</Pill>}
            </div>
            <div className="tpl-cols">
              <div>
                <div className="col-h">Required documents</div>
                <div className="chip-row">{t.documents.map((d) => <span key={d} className="chip">{d}</span>)}</div>
              </div>
              <div>
                <div className="col-h">Approval workflow</div>
                <div className="flow-row">
                  {t.workflow.map((w, i) => (
                    <Fragment key={w}>
                      {i > 0 && <span className="arr">→</span>}
                      <span className="fstep">{w}</span>
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

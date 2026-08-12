import { Link } from 'react-router-dom'
import { Card, Button } from '../components/ui'
import { Icon } from '../components/ui/icons'

export function Forbidden() {
  return (
    <div className="page-head">
      <h1>You don&apos;t have access to this page <span className="page-info-ic" title="Your role doesn't include permission to view this section. Switch to an admin account or return to your dashboard."><Icon name="help" size={13} /></span></h1>
      <Card>
        <div style={{ padding: '0.5rem 0' }}>
          <Link to="/dashboard"><Button variant="primary">Back to Dashboard</Button></Link>
        </div>
      </Card>
    </div>
  )
}

import type { PersonaDashboard, RoleCode } from '../types'

// Per-persona dashboard content: KPIs (with deltas), journey tracker, a generative
// insight, the "up next" nudge and quick actions. Routes must exist in that
// persona's MODULES_BY_ROLE list or the shell guard bounces them to /dashboard.
export const DASHBOARDS: Record<RoleCode, PersonaDashboard> = {
  // ASE — frontline field work: scout, visit, rate infrastructure, build the shortlist.
  ase_asm: {
    roleCode: 'ase_asm',
    kpis: [
      { label: 'Candidates scouted', value: '3', delta: '↑ 50%', deltaGood: true },
      { label: 'Shortlisted', value: '2', delta: '↑ 1', deltaGood: true },
      { label: 'Avg. AI confidence', value: '92%', accent: true, delta: '↑ 8%', deltaGood: true },
      { label: 'Avg. time to shortlist', value: '2.1d', delta: '↓ 0.5d', deltaGood: true },
    ],
    journey: [
      { label: 'Scout candidates', state: 'done', route: '/intake-inbox', count: 3 },
      { label: 'Field visits & infra rating', state: 'current', route: '/intake-inbox' },
      { label: 'Build shortlist', state: 'current', route: '/leads' },
      { label: 'Hand to ASM', state: 'upcoming', route: '/leads' },
      { label: 'Respond if flagged', state: 'upcoming', route: '/approvals', count: 4 },
    ],
    insight: 'Your Nashik shortlist is looking strong — the top candidate rates 8/10 on infrastructure, the best fit you\'ve scouted this quarter.',
    upNext: { lead: 'Finish shortlisting for', detail: 'Nashik · GT DB (with CSO/DSM)', cta: 'Open scouting', route: '/intake-inbox' },
    quickActions: [
      { label: 'Scouting', route: '/intake-inbox', icon: 'search' },
      { label: 'My shortlist', route: '/leads', icon: 'leads' },
      { label: 'Needs my response', route: '/communication', icon: 'comms', count: 2 },
    ],
  },
  // ASM — oversees ASEs: reviews the shortlist, submits the recommendation, finalises.
  asm: {
    roleCode: 'asm',
    kpis: [
      { label: 'Submitted this month', value: '3', delta: '↑ 50%', deltaGood: true },
      { label: 'Pending evaluation', value: '1', delta: '↓ 25%', deltaGood: false },
      { label: 'Avg. AI confidence', value: '92%', accent: true, delta: '↑ 8%', deltaGood: true },
      { label: 'Avg. time to close', value: '1.6d', delta: '↓ 0.4d', deltaGood: true },
    ],
    journey: [
      { label: 'Review ASE shortlist', state: 'current', route: '/leads' },
      { label: 'Submit recommendation', state: 'current', route: '/new-application' },
      { label: 'Await evaluation', state: 'upcoming', route: '/approvals', count: 1 },
      { label: 'Finalise sign-off', state: 'upcoming', route: '/approvals', count: 4 },
      { label: 'Case closed', state: 'upcoming', route: '/partners' },
    ],
    insight: 'Your Nashik submission is tracking to auto-clear at 92% confidence — the strongest infra fit submitted this quarter.',
    upNext: { lead: 'Review AI-ranked candidates for', detail: 'Nashik · GT DB (with CSO/DSM)', cta: 'Review now', route: '/new-application' },
    quickActions: [
      { label: 'Submit a recommendation', route: '/new-application', icon: 'new' },
      { label: 'Flagged cases', route: '/approvals', icon: 'flag', count: 4 },
      { label: 'Needs my response', route: '/communication', icon: 'comms', count: 2 },
    ],
  },
  // RBL — regional supervisor: watches the shared workbasket, hands out unpicked DBs to idle
  // ASMs, and keeps an eye on team load & availability.
  rbl: {
    roleCode: 'rbl',
    kpis: [
      { label: 'Unassigned DBs', value: '53', accent: true, delta: '↓ 6', deltaGood: true },
      { label: 'ASEs idle', value: '1', delta: '— steady', deltaGood: false },
      { label: 'Team utilisation', value: '72%', delta: '↑ 5pp', deltaGood: true },
      { label: 'Awaiting my sign-off', value: '2', delta: '↑ 1', deltaGood: false },
    ],
    journey: [
      { label: 'ASEs shortlist DBs', state: 'done', route: '/leads', count: 60 },
      { label: 'Assign DBs to ASEs', state: 'current', route: '/leads' },
      { label: 'Balance load / rebalance', state: 'current', route: '/leads' },
      { label: 'Cover leave / issues', state: 'upcoming', route: '/team' },
      { label: 'Final sign-off (> ₹50L)', state: 'upcoming', route: '/approvals', count: 2 },
    ],
    insight: 'The DB pool has 53 unassigned DBs while N. Rao (Karnataka ASE) is still idle — assign a batch to balance the load before the shortlist SLA slips. Two > ₹50L cases are awaiting your sign-off.',
    upNext: { lead: 'Assign unassigned DBs to', detail: 'N. Rao · idle ASE', cta: 'Open DB pool', route: '/leads' },
    quickActions: [
      { label: 'Assign DBs to ASEs', route: '/leads', icon: 'leads' },
      { label: 'Team load & availability', route: '/team', icon: 'user' },
      { label: 'Rebalance flagged work', route: '/leads', icon: 'flag' },
      { label: 'Final sign-off queue', route: '/approvals', icon: 'approvals', count: 2 },
    ],
  },
  finance: {
    roleCode: 'finance',
    kpis: [
      { label: 'Awaiting review', value: '4', accent: true, delta: '↑ 1', deltaGood: false },
      { label: 'Avg. turnaround', value: '1.6d', delta: '↓ 0.3d', deltaGood: true },
      { label: 'Cases reaching Finance', value: '19%', delta: '↓ 2pp', deltaGood: true },
      { label: 'Overdue right now', value: '1', delta: '↑ 1', deltaGood: false },
    ],
    journey: [
      { label: 'Case lands in queue', state: 'done', route: '/approvals', count: 4 },
      { label: 'Review flagged criteria', state: 'current', route: '/approvals' },
      { label: 'Discuss with ASM', state: 'upcoming', route: '/communication', count: 2 },
      { label: 'Approve or reject', state: 'upcoming', route: '/approvals' },
      { label: 'Audit trail logged', state: 'upcoming' },
    ],
    insight: 'One case (CMP-2291) is overdue. The most common flag this month is CC-limit shortfall — 3 of 4 queued cases.',
    upNext: { lead: 'Clear the overdue CC-limit case', detail: 'CMP-2291 · Malhotra Distributors · Overdue', cta: 'Open case', route: '/approvals' },
    quickActions: [
      { label: 'My approval queue', route: '/approvals', icon: 'approvals', count: 4 },
      { label: 'Case discussions', route: '/communication', icon: 'comms', count: 2 },
      { label: 'Documents queue', route: '/documents', icon: 'documents' },
    ],
  },
  channel_dev: {
    roleCode: 'channel_dev',
    kpis: [
      { label: 'Awaiting review', value: '3', accent: true, delta: '↓ 1', deltaGood: true },
      { label: 'Cases reaching Channel Dev.', value: '14%', delta: '↓ 1.5pp', deltaGood: true },
      { label: 'Avg. infra score', value: '8.1', delta: '↑ 0.4', deltaGood: true },
      { label: 'Approved this week', value: '5', delta: '↑ 2', deltaGood: true },
    ],
    journey: [
      { label: 'Case lands in queue', state: 'done', route: '/approvals', count: 3 },
      { label: 'Review infra & coverage', state: 'current', route: '/new-application' },
      { label: 'Discuss with ASM', state: 'upcoming', route: '/communication', count: 2 },
      { label: 'Approve or reject', state: 'upcoming', route: '/approvals' },
    ],
    insight: 'Infra scores are up 0.4 pts vs last quarter — Gujarat candidates are leading on godown capacity.',
    upNext: { lead: 'Review the infra score on', detail: 'CMP-2280 · Deccan Trade Links · 1d left', cta: 'Open case', route: '/approvals' },
    quickActions: [
      { label: 'My review queue', route: '/approvals', icon: 'approvals', count: 3 },
      { label: 'Coverage gaps', route: '/leads', icon: 'leads', count: 3 },
      { label: 'At-risk distributors', route: '/analytics', icon: 'analytics', count: 3 },
    ],
  },
  mdm: {
    roleCode: 'mdm',
    kpis: [
      { label: 'Ready for document check', value: '6', accent: true, delta: '↑ 2', deltaGood: false },
      { label: 'Verified this week', value: '2', delta: '↑ 1', deltaGood: true },
      { label: 'Cases with verification on', value: '0%', delta: '— steady', deltaGood: true },
      { label: 'Mismatches flagged', value: '0', delta: '— steady', deltaGood: true },
    ],
    journey: [
      { label: 'Case reaches document stage', state: 'done', route: '/documents', count: 6 },
      { label: 'Toggle Document Intelligence', state: 'current', route: '/documents' },
      { label: 'Verify extracted fields', state: 'upcoming', route: '/documents' },
      { label: 'Confirm & onboard', state: 'upcoming', route: '/approvals', count: 4 },
    ],
    insight: 'Document Intelligence remains off by default across all cases — matching RCPL\'s current process. Turn it on per case when ready.',
    upNext: { lead: 'Run the document check on', detail: 'VND-0417 · Krishna Packaging · 2 docs missing', cta: 'Open documents', route: '/documents' },
    quickActions: [
      { label: 'Ready for doc check', route: '/documents', icon: 'documents', count: 6 },
      { label: 'Approvals queue', route: '/approvals', icon: 'approvals', count: 4 },
      { label: 'Case discussions', route: '/communication', icon: 'comms', count: 2 },
    ],
  },
  leadership: {
    roleCode: 'leadership',
    kpis: [
      { label: 'Appointed this quarter', value: '47', delta: '↑ 12%', deltaGood: true },
      { label: 'Resolved by AI', value: '61%', accent: true, delta: '↑ 12pp', deltaGood: true },
      { label: 'Open discontinuations', value: '6', delta: '↓ 2', deltaGood: true },
      { label: 'Avg. cycle time', value: '1.9d', delta: '↓ 0.5d', deltaGood: true },
    ],
    journey: [
      { label: 'Open analytics', state: 'current', route: '/analytics' },
      { label: 'Read generative insight', state: 'upcoming', route: '/analytics' },
      { label: 'Ask copilot', state: 'upcoming' },
      { label: 'Share or export', state: 'upcoming', route: '/reports' },
    ],
    insight: 'Auto-approval rate climbed to 61% (+12pp) this quarter, driven by tighter ARC alignment in Gujarat and Maharashtra.',
    upNext: { lead: 'See how distributors track against plan', detail: '3 at risk · 3 on watch', cta: 'Open analytics', route: '/analytics' },
    quickActions: [
      { label: 'Distributor performance', route: '/analytics', icon: 'analytics' },
      { label: 'GTM coverage', route: '/gtm-coverage', icon: 'target' },
      { label: 'Reports', route: '/reports', icon: 'documents' },
    ],
  },
  // IT — creates the DB Code once a DB clears approval (Approvals' Onboarding tab, Appointment
  // stage) and hands off SFA/system access, inside the D+2 working-day SLA.
  it: {
    roleCode: 'it',
    kpis: [
      { label: 'Awaiting DB Code', value: '1', accent: true, delta: '— steady', deltaGood: true },
      { label: 'Created this month', value: '4', delta: '↑ 1', deltaGood: true },
      { label: 'Avg. time to create', value: '1.2d', delta: '↓ 0.3d', deltaGood: true },
      { label: 'Within D+2 SLA', value: '100%', delta: '— steady', deltaGood: true },
    ],
    journey: [
      { label: 'DB clears final sign-off', state: 'done', route: '/approvals' },
      { label: 'Create DB Code', state: 'current', route: '/approvals', count: 1 },
      { label: 'Confirm in Partners directory', state: 'upcoming', route: '/partners' },
      { label: 'Handholding / Central Induction', state: 'upcoming', route: '/approvals' },
    ],
    insight: 'One DB is sitting in the Appointment stage awaiting its DB Code — create it from Approvals › Onboarding to keep the D+2 SLA on track.',
    upNext: { lead: 'Create the DB Code for', detail: 'Appointment stage · onboarding queue', cta: 'Open onboarding', route: '/approvals' },
    quickActions: [
      { label: 'Onboarding queue', route: '/approvals', icon: 'approvals', count: 1 },
      { label: 'Partners directory', route: '/partners', icon: 'partners' },
      { label: 'Audit log', route: '/audit-log', icon: 'list' },
    ],
  },
  admin: {
    roleCode: 'admin',
    kpis: [
      { label: 'Partner types configured', value: '2', delta: '— steady', deltaGood: true },
      { label: 'Coming soon', value: '2', delta: '— steady', deltaGood: true },
      { label: 'Active workflows', value: '2', delta: '— steady', deltaGood: true },
      { label: 'Agents online', value: '7', accent: true, delta: '↑ 1', deltaGood: true },
    ],
    journey: [
      { label: 'Review templates', state: 'current', route: '/templates', count: 2 },
      { label: 'Configure partner type', state: 'upcoming', route: '/templates' },
      { label: 'Map documents & workflow', state: 'upcoming', route: '/templates' },
      { label: 'Publish', state: 'upcoming', route: '/templates' },
    ],
    insight: 'Distributor and Vendor templates are live. Adding "Logistics Partner" is a new row in Templates — no deployment needed.',
    upNext: { lead: 'Configure the next partner type', detail: 'Logistics Partner · docs & workflow to map', cta: 'Open templates', route: '/templates' },
    quickActions: [
      { label: 'Manage users', route: '/settings', icon: 'user' },
      { label: 'Templates', route: '/templates', icon: 'templates' },
      { label: 'Audit log', route: '/audit-log', icon: 'list' },
    ],
  },
}

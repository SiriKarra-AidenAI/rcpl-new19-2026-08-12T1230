import type { CSSProperties, ReactNode } from 'react'

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export type IconName =
  | 'dashboard' | 'new' | 'approvals' | 'documents' | 'comms'
  | 'analytics' | 'partners' | 'templates' | 'settings' | 'spark' | 'send' | 'close'
  | 'target' | 'list' | 'leads' | 'search' | 'bell' | 'logout' | 'back'
  | 'mail' | 'robot' | 'bolt' | 'shield' | 'user' | 'help' | 'external' | 'flag'
  | 'check' | 'clock' | 'alert' | 'upload' | 'filter' | 'download' | 'more'
  | 'plus' | 'chevronDown' | 'chevronRight' | 'calendar'
  | 'lock' | 'dollar' | 'wrench' | 'monitor' | 'bulb' | 'info'

// Duotone icons: a soft, translucent accent-tinted body (`ic-fill`) sits behind a
// crisp outline. Both derive from `currentColor`, so an icon follows its context —
// muted grey when idle, violet when the nav item is active — with the fill giving
// each glyph real body instead of a flat single-weight line. Solid accents (dots)
// go in `ic-solid` so they stay opaque. Active-state fill boost lives in Shell.css.
const Fill = ({ children, o = 0.16 }: { children: ReactNode; o?: number }) => (
  <g className="ic-fill" fill="currentColor" stroke="none" fillOpacity={o}>{children}</g>
)
const Solid = ({ children }: { children: ReactNode }) => (
  <g className="ic-solid" fill="currentColor" stroke="none">{children}</g>
)

const paths: Record<IconName, JSX.Element> = {
  dashboard: <>
    <Fill><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Fill>
    <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>,
  new: <>
    <Fill><circle cx="12" cy="12" r="9" /></Fill>
    <circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" />
  </>,
  approvals: <>
    <Fill><path d="M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /></Fill>
    <path d="M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <rect x="8.5" y="2.5" width="7" height="4" rx="1.4" />
    <path d="M8.3 13.2l2.4 2.4 4.8-5.3" />
  </>,
  documents: <>
    <Fill><path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /></Fill>
    <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path d="M14 2v4h4M8 13h8M8 17h5" />
  </>,
  comms: <>
    <Fill><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L4 21l1.1-3.7A8.4 8.4 0 1 1 21 11.5z" /></Fill>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L4 21l1.1-3.7A8.4 8.4 0 1 1 21 11.5z" />
    <Solid><circle cx="8.5" cy="11.5" r="1.05" /><circle cx="12" cy="11.5" r="1.05" /><circle cx="15.5" cy="11.5" r="1.05" /></Solid>
  </>,
  analytics: <>
    <Fill><path d="M8 16l3-4 3 2 4-6v12H8z" /></Fill>
    <path d="M4 20V4M4 20h16" /><path d="M8 16l3-4 3 2 4-6" />
  </>,
  partners: <>
    <Fill><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0z" /></Fill>
    <circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 5.5a3 3 0 0 1 0 5.5M21 20a5.8 5.8 0 0 0-3.5-5.3" />
  </>,
  templates: <>
    <Fill><rect x="4" y="4.2" width="16" height="4.3" rx="1" /></Fill>
    <rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 9h18M9 9v12" />
  </>,
  settings: <>
    <Fill><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 6 8.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.4 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></Fill>
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 6 8.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.4 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </>,
  target: <>
    <Fill><circle cx="12" cy="12" r="5" /></Fill>
    <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" />
    <Solid><circle cx="12" cy="12" r="1.6" /></Solid>
  </>,
  list: <>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <Solid><circle cx="3.6" cy="6" r="1.15" /><circle cx="3.6" cy="12" r="1.15" /><circle cx="3.6" cy="18" r="1.15" /></Solid>
  </>,
  leads: <>
    <Fill><path d="M3 17l5-5 4 3 8-8v13H3z" /></Fill>
    <path d="M3 17l5-5 4 3 8-8" /><path d="M15 4h6v6" />
  </>,

  spark: <>
    <Fill><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /></Fill>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
  </>,
  send: <>
    <Fill><path d="M4 12l16-8-6 16-3-6-7-2z" /></Fill>
    <path d="M4 12l16-8-6 16-3-6-7-2z" />
  </>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  search: <>
    <Fill><circle cx="11" cy="11" r="7" /></Fill>
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
  </>,
  bell: <>
    <Fill><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9z" /></Fill>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </>,
  logout: <>
    <Fill><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4z" /></Fill>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" />
  </>,
  back: <><path d="M15 18l-6-6 6-6" /></>,

  mail: <>
    <Fill><rect x="3" y="5" width="18" height="14" rx="2.5" /></Fill>
    <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7.5l8 5.5 8-5.5" />
  </>,
  robot: <>
    <Fill><rect x="4" y="8" width="16" height="11" rx="3" /></Fill>
    <rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4.6V8M2.5 12.5v3M21.5 12.5v3M9.5 16.2h5" />
    <Solid><circle cx="12" cy="3.4" r="1.2" /><circle cx="9" cy="13" r="1.2" /><circle cx="15" cy="13" r="1.2" /></Solid>
  </>,
  bolt: <>
    <Fill><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" /></Fill>
    <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
  </>,
  shield: <>
    <Fill><path d="M12 3l7 3v5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6z" /></Fill>
    <path d="M12 3l7 3v5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6z" /><path d="M9 12l2 2 4-4" />
  </>,
  user: <>
    <Fill><circle cx="12" cy="8" r="3.4" /><path d="M5 20a7 7 0 0 1 14 0z" /></Fill>
    <circle cx="12" cy="8" r="3.4" /><path d="M5 20a7 7 0 0 1 14 0" />
  </>,
  help: <>
    <Fill><circle cx="12" cy="12" r="9" /></Fill>
    <circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1 .9-1 1.6" />
    <Solid><circle cx="12" cy="16.6" r="1.05" /></Solid>
  </>,
  external: <><path d="M14 4h6v6M20 4l-8 8M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
  flag: <>
    <Fill><path d="M5 4h11l-2 3.5L16 11H5z" /></Fill>
    <path d="M5 21V4h11l-2 3.5L16 11H5" />
  </>,

  check: <>
    <Fill><circle cx="12" cy="12" r="9" /></Fill>
    <circle cx="12" cy="12" r="9" /><path d="M8.4 12.2l2.4 2.4 4.8-5" />
  </>,
  clock: <>
    <Fill><circle cx="12" cy="12" r="9" /></Fill>
    <circle cx="12" cy="12" r="9" /><path d="M12 7.4V12l3 1.9" />
  </>,
  alert: <>
    <Fill><path d="M12 3.4l9 15.6H3z" /></Fill>
    <path d="M12 3.4l9 15.6H3z" /><path d="M12 9.6v4.1" />
    <Solid><circle cx="12" cy="16.4" r="1.05" /></Solid>
  </>,
  upload: <>
    <Fill><path d="M12 3.6l4.6 5.2H7.4z" /></Fill>
    <path d="M12 15.5V4M7.6 8.4L12 4l4.4 4.4" /><path d="M4 19.5h16" />
  </>,
  filter: <>
    <Fill><path d="M3.5 5h17l-6.6 7.6v5.1l-3.8 2v-7.1z" /></Fill>
    <path d="M3.5 5h17l-6.6 7.6v5.1l-3.8 2v-7.1z" />
  </>,
  calendar: <>
    <Fill><rect x="3.5" y="5.5" width="17" height="15" rx="2.5" /></Fill>
    <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
  </>,
  download: <>
    <Fill><path d="M12 14.5l4.2-4.3H7.8z" /></Fill>
    <path d="M12 4v10.4M7.8 10.2L12 14.5l4.2-4.3" /><path d="M5 19.5h14" />
  </>,
  more: <Solid><circle cx="12" cy="5.4" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="18.6" r="1.7" /></Solid>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  chevronDown: <><path d="M6 9.5l6 6 6-6" /></>,
  chevronRight: <><path d="M9 6l6 6-6 6" /></>,

  lock: <>
    <Fill><rect x="5" y="11" width="14" height="9.5" rx="2" /></Fill>
    <rect x="5" y="11" width="14" height="9.5" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    <Solid><circle cx="12" cy="15.4" r="1.2" /></Solid>
  </>,
  dollar: <>
    <Fill><circle cx="12" cy="12" r="9" /></Fill>
    <circle cx="12" cy="12" r="9" /><path d="M12 6.5v11M15 9.3c0-1.3-1.3-2.1-3-2.1s-3 .8-3 2.1c0 3 6 1.5 6 4.6 0 1.4-1.4 2.3-3 2.3s-3-.9-3-2.3" />
  </>,
  wrench: <>
    <Fill><path d="M14.5 3.3a5 5 0 0 0-6.4 6.4L3 15v4h4l5.3-5.1a5 5 0 0 0 6.4-6.4l-3 3-2.4-2.4z" /></Fill>
    <path d="M14.5 3.3a5 5 0 0 0-6.4 6.4L3 15v4h4l5.3-5.1a5 5 0 0 0 6.4-6.4l-3 3-2.4-2.4z" />
  </>,
  monitor: <>
    <Fill><rect x="3" y="4.5" width="18" height="12.5" rx="2" /></Fill>
    <rect x="3" y="4.5" width="18" height="12.5" rx="2" /><path d="M8.5 21h7M12 17v4" />
  </>,
  bulb: <>
    <Fill><path d="M12 3.5a6 6 0 0 0-3.5 10.9c.6.4.9 1 .9 1.7v.4h5.2v-.4c0-.7.3-1.3.9-1.7A6 6 0 0 0 12 3.5z" /></Fill>
    <path d="M12 3.5a6 6 0 0 0-3.5 10.9c.6.4.9 1 .9 1.7v.4h5.2v-.4c0-.7.3-1.3.9-1.7A6 6 0 0 0 12 3.5z" />
    <path d="M9.6 19h4.8M10.3 21h3.4" />
  </>,
  info: <>
    <Fill><circle cx="12" cy="12" r="9" /></Fill>
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" />
    <Solid><circle cx="12" cy="7.8" r="1.05" /></Solid>
  </>,
}

export function Icon({ name, size, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return (
    <svg {...base} width={size ?? base.width} height={size ?? base.height} style={style} aria-hidden>
      {paths[name]}
    </svg>
  )
}

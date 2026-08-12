/** Tiny inline SVG sparkline with an area fill and an emphasized endpoint.
 *  `responsive` makes it fill its container's width (viewBox scales) instead of a fixed px width. */
export function Sparkline({ data, color = 'var(--ai)', width = 68, height = 26, responsive = false }:
  { data: number[]; color?: string; width?: number; height?: number; responsive?: boolean }) {
  if (data.length < 2) return null
  const max = Math.max(...data), min = Math.min(...data)
  const span = max - min || 1
  const pad = 2
  const x = (i: number) => pad + (i * (width - pad * 2)) / (data.length - 1)
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2)
  const line = data.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`
  const gid = `sg-${Math.round(x(1) * 100)}-${data.length}-${Math.round(max)}`
  const lastX = x(data.length - 1), lastY = y(data[data.length - 1])
  return (
    <svg
      width={responsive ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={responsive ? 'none' : 'xMidYMid meet'}
      aria-hidden
      style={{ display: 'block', maxWidth: '100%' }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2.6} fill={color} />
    </svg>
  )
}

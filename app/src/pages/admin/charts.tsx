// The 운영실's small charts, as plain SVG (no chart library). Colours are the
// app tokens, set through style so CSS variables apply.

type Tone = 'good' | 'danger' | 'accent' | 'muted'

/** A line with a soft fill under it. Missing values (null) are left out; a
 *  dashed `goal` line is drawn on the same scale. */
export function Sparkline({ values, tone, height = 30, goal, strong = false, label }: {
  values: (number | null)[]
  tone: Tone
  height?: number
  goal?: number
  /** The north-star card: a thicker line and fill. */
  strong?: boolean
  label?: string
}) {
  const W = 100
  const known = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null)
  const all = [...known.map((p) => p.v), ...(goal !== undefined ? [goal] : [])]
  const lo = all.length ? Math.min(...all) : 0
  const hi = all.length ? Math.max(...all) : 1
  const range = hi - lo || 1
  const y = (v: number) => height - 3 - ((v - lo) / range) * (height - 8)
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : W / 2)
  const pts = known.map((p) => `${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ')
  const color = `var(--${tone})`
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      className="hq-spark" style={{ height }}>
      {goal !== undefined && (
        <line x1="0" x2={W} y1={y(goal)} y2={y(goal)} style={{ stroke: color, strokeOpacity: 0.55 }} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      )}
      {known.length > 1 && (
        <>
          <polygon points={`${x(known[0].i)},${height} ${pts} ${x(known[known.length - 1].i)},${height}`} style={{ fill: color, fillOpacity: strong ? 0.22 : 0.12 }} />
          <polyline points={pts} style={{ fill: 'none', stroke: color, strokeWidth: strong ? 2.4 : 1.8 }} vectorEffect="non-scaling-stroke" />
        </>
      )}
      {known.length === 1 && <circle cx={x(known[0].i)} cy={y(known[0].v)} r="2" style={{ fill: color }} />}
    </svg>
  )
}

/** One bar per hour from `from` to `to`; the busiest in --accent with its count. */
export function HourBars({ byHour, from = 5, to = 22, busiest }: { byHour: number[]; from?: number; to?: number; busiest: number | null }) {
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const max = Math.max(1, ...hours.map((h) => byHour[h] ?? 0))
  return (
    <div className="hq-bars" role="img" aria-label={`시간대별 사진: ${hours.filter((h) => byHour[h]).map((h) => `${h}시 ${byHour[h]}장`).join(', ') || '없음'}`}>
      {hours.map((h) => {
        const v = byHour[h] ?? 0
        return (
          <div key={h} className={h === busiest ? 'hi' : undefined}>
            <em className="num">{h === busiest ? v : ''}</em>
            <span style={{ height: `${Math.max(3, Math.round((v / max) * 110))}px` }} />
            {/* Every column keeps its label row, so the bars share one baseline. */}
            <small className="num">{h % 3 === 0 ? `${h}시` : '\u00a0'}</small>
          </div>
        )
      })}
    </div>
  )
}

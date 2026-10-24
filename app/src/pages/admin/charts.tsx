// The 운영실's small charts, as plain SVG (no chart library). Colours are the
// app tokens, set through style so CSS variables apply.

import { useEffect, useRef, useState } from 'react'
import { fourMarks } from '../../lib/adminGrowth'

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

/** 90 days of two series: an orange area (활동 부모님) and a dashed line
 *  (누적 가족), with y ticks, four date labels and the last values written. */
export function TrendChart({ dates, area, line, ticks, dateText, label }: {
  dates: string[]
  area: number[]
  line: number[]
  ticks: number[]
  /** How a date under the chart reads ("10월 24일"). */
  dateText: (date: string) => string
  label: string
}) {
  // Drawn at the card's own width, so its text stays 12–13px on a phone too.
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(900)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = 210, top = 14, bottom = 180, left = 40, right = 40
  // Four dates when there is room; on a narrow phone the first and the last.
  const idx = W >= 560 ? fourMarks(dates.length) : [...new Set([0, Math.max(0, dates.length - 1)])]
  const marks = idx.map((i) => ({ i, text: dateText(dates[i] ?? '') }))
  const maxY = ticks[ticks.length - 1] || 1
  const n = Math.max(2, dates.length)
  const x = (i: number) => left + (i / (n - 1)) * (W - left - right)
  const y = (v: number) => bottom - (v / maxY) * (bottom - top)
  const pts = (s: number[]) => s.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const muted = { fill: 'var(--muted)' }
  const lastA = area[area.length - 1] ?? 0
  const lastL = line[line.length - 1] ?? 0
  // Keep the two end labels apart when the values are close.
  const gap = Math.abs(y(lastA) - y(lastL)) < 16
  return (
    <div ref={box} className="hq-trend-box">
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="hq-trend" role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--line)' }} strokeWidth="1" />
          <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" style={muted}>{t}</text>
        </g>
      ))}
      {marks.map((m, k) => (
        <text key={m.i} x={x(m.i)} y={H - 4} fontSize="12" style={muted} textAnchor={k === 0 ? 'start' : k === marks.length - 1 ? 'end' : 'middle'}>{m.text}</text>
      ))}
      {area.length > 1 && <polygon points={`${x(0)},${bottom} ${pts(area)} ${x(area.length - 1)},${bottom}`} style={{ fill: 'var(--accent)', fillOpacity: 0.14 }} />}
      {line.length > 1 && <polyline points={pts(line)} style={{ fill: 'none', stroke: 'var(--muted)' }} strokeWidth="2" strokeDasharray="5 4" />}
      {area.length > 1 && <polyline points={pts(area)} style={{ fill: 'none', stroke: 'var(--accent)' }} strokeWidth="2.5" />}
      {area.length > 0 && (
        <>
          <circle cx={x(area.length - 1)} cy={y(lastA)} r="5" style={{ fill: 'var(--accent)' }} />
          <text x={x(area.length - 1) + 9} y={y(lastA) + (gap && lastA <= lastL ? 14 : 4)} fontSize="13" fontWeight="800" style={{ fill: 'var(--ink)' }}>{lastA}</text>
        </>
      )}
      {line.length > 0 && (
        <>
          <circle cx={x(line.length - 1)} cy={y(lastL)} r="4" style={{ fill: 'var(--muted)' }} />
          <text x={x(line.length - 1) + 9} y={y(lastL) + (gap && lastL < lastA ? 14 : gap ? -6 : 4)} fontSize="13" fontWeight="800" style={{ fill: 'var(--ink)' }}>{lastL}</text>
        </>
      )}
    </svg>
    </div>
  )
}

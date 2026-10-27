import { useId } from 'react'
import { placeVisits, project, type LatLng, type TrailStop } from '../lib/trail'
import { listPhoto } from '../lib/listPhoto'
import { tr } from '../lib/lang'

const W = 320
const H = 200
/** The wide box on the parent's day (A13): 150px tall, filling its width. */
const WIDE = { w: 330, h: 150 }

/**
 * The route drawn without a map: the stops joined in the order they were
 * visited, north up, one pin per place (A14.5) carrying its visit numbers
 * (`1·5·9`), with home marked when it is nearby. Needs no map
 * key and makes no map request, so it is what a digest shows.
 */
export function TrailSketch({ stops, home, thumbs = false, wide = false, onPick }: {
  stops: TrailStop[]
  /** Shown only when it is close enough to belong in the picture. */
  home?: LatLng | null
  /** Put each stop's first photo on its pin. */
  thumbs?: boolean
  /** Fill a short, wide box (cropping a little at the edges instead of
   *  leaving bands); the pins keep clear of the crop. */
  wide?: boolean
  onPick?: (stop: TrailStop) => void
}) {
  // Clip paths are looked up by id across the whole page: keep them unique per sketch.
  const clipId = useId()
  if (stops.length === 0) return null
  const w = wide ? WIDE.w : W
  const h = wide ? WIDE.h : H
  const pad = thumbs ? 34 : wide ? 26 : 22
  const xy = project([...stops, ...(home ? [home] : [])], w, h, pad)
  const homeXY = home ? xy[stops.length] : null
  const r = thumbs ? 17 : 11
  const places = placeVisits(stops)
  // A chip as wide as its numbers: a circle for one, a pill for `1·5`.
  const chipW = (label: string, base: number) => Math.max(base * 2, label.length * 6.5 + 8)
  return (
    <svg className="trail-sketch" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio={wide ? 'xMidYMid slice' : undefined} role="img" aria-label={tr(`다녀온 곳 ${places.length}곳`, `${places.length} place${places.length === 1 ? '' : 's'} visited`)}>
      {stops.length > 1 && (
        <polyline
          points={xy.slice(0, stops.length).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".55"
        />
      )}
      {homeXY && (
        <g>
          <circle cx={homeXY.x} cy={homeXY.y} r="10" fill="#fff" stroke="var(--ink-3)" strokeWidth="1.5" />
          <text x={homeXY.x} y={homeXY.y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--ink-2)">{tr('집', 'Home')}</text>
        </g>
      )}
      {places.map((pl, k) => {
        const p = xy[pl.visits[0] - 1]
        const photo = thumbs ? listPhoto(pl.memos[0]) : ''
        const stop = stops[pl.visits[0] - 1]
        const cw = chipW(pl.label, photo ? 8 : r)
        return (
          <g key={k} onClick={onPick ? () => onPick(stop) : undefined} style={onPick ? { cursor: 'pointer' } : undefined}>
            {photo && (
              <>
                <clipPath id={`${clipId}-${k}`}><circle cx={p.x} cy={p.y} r={r - 2} /></clipPath>
                <image href={photo} x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId}-${k})`} />
                <circle cx={p.x} cy={p.y} r={r} fill="none" stroke="#fff" strokeWidth="2" />
                <rect x={p.x + r - 3 - cw / 2} y={p.y - r - 5} width={cw} height="16" rx="8" fill="var(--accent)" stroke="#fff" strokeWidth="1.5" />
                <text x={p.x + r - 3} y={p.y - r + 6.5} textAnchor="middle" fontSize="10" fontWeight="800" fill="var(--ink)">{pl.label}</text>
              </>
            )}
            {!photo && (
              <>
                <rect x={p.x - cw / 2} y={p.y - r} width={cw} height={r * 2} rx={r} fill="var(--accent)" stroke="#fff" strokeWidth="2" />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--ink)">{pl.label}</text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

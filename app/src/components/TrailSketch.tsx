import { useId } from 'react'
import { project, type LatLng, type TrailStop } from '../lib/trail'

const W = 320
const H = 200

/**
 * The route drawn without a map: numbered stops joined in the order they
 * were visited, north up, with home marked when it is nearby. Needs no map
 * key and makes no map request, so it is what a digest shows.
 */
export function TrailSketch({ stops, home, thumbs = false, onPick }: {
  stops: TrailStop[]
  /** Shown only when it is close enough to belong in the picture. */
  home?: LatLng | null
  /** Put each stop's first photo on its pin. */
  thumbs?: boolean
  onPick?: (stop: TrailStop) => void
}) {
  // Clip paths are looked up by id across the whole page: keep them unique per sketch.
  const clipId = useId()
  if (stops.length === 0) return null
  const pad = thumbs ? 34 : 22
  const xy = project([...stops, ...(home ? [home] : [])], W, H, pad)
  const homeXY = home ? xy[stops.length] : null
  const r = thumbs ? 17 : 11
  return (
    <svg className="trail-sketch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`다녀온 곳 ${stops.length}곳`}>
      {stops.length > 1 && (
        <polyline
          points={xy.slice(0, stops.length).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".55"
        />
      )}
      {homeXY && (
        <g>
          <circle cx={homeXY.x} cy={homeXY.y} r="10" fill="#fff" stroke="var(--ink-3)" strokeWidth="1.5" />
          <text x={homeXY.x} y={homeXY.y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--ink-2)">집</text>
        </g>
      )}
      {stops.map((s, i) => {
        const p = xy[i]
        const photo = thumbs ? s.memos[0].photoUrl : ''
        return (
          <g key={i} onClick={onPick ? () => onPick(s) : undefined} style={onPick ? { cursor: 'pointer' } : undefined}>
            {photo && (
              <>
                <clipPath id={`${clipId}-${i}`}><circle cx={p.x} cy={p.y} r={r - 2} /></clipPath>
                <image href={photo} x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId}-${i})`} />
              </>
            )}
            <circle cx={p.x} cy={p.y} r={r} fill={photo ? 'none' : 'var(--accent)'} stroke="#fff" strokeWidth="2" />
            {photo
              ? <>
                  <circle cx={p.x + r - 3} cy={p.y - r + 3} r="8" fill="var(--accent)" stroke="#fff" strokeWidth="1.5" />
                  <text x={p.x + r - 3} y={p.y - r + 6.5} textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">{i + 1}</text>
                </>
              : <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff">{i + 1}</text>}
          </g>
        )
      })}
    </svg>
  )
}

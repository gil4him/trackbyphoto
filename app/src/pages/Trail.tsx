import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtTime } from '../util'
import { TrailSketch } from '../components/TrailSketch'
import { MemoRow } from '../components/MemoRow'
import { MAP_KEYS, KAKAO_USABLE, pickProvider, type MapKeys } from '../lib/map'
import { staticMapUrl } from '../lib/map/googleStatic'
import { renderKakaoMap } from '../lib/map/kakao'
import { AWAY_KM, fmtKm, trailStops, trailSummary, type LatLng, type TrailStop } from '../lib/trail'
import type { Memo } from '../types'

/** Under the map: each stop in order as a memo row (A13), numbered like its
 *  pin — the stop's first photo, with the time, the neighbourhood and how far
 *  from home it was. */
export function TrailList({ stops, onOpenMemo }: { stops: TrailStop[]; onOpenMemo: (memoId: string) => void }) {
  return (
    <ol className="trail-list">
      {stops.map((s, i) => {
        const km = s.kmFromHome !== null ? (fmtKm(s.kmFromHome) === '집 근처' ? '집 근처' : `집에서 ${fmtKm(s.kmFromHome)}`) : ''
        const meta = [fmtTime(s.firstAt), s.area, km, s.memos.length > 1 ? `사진 ${s.memos.length}장` : ''].filter(Boolean).join(' · ')
        return (
          <li key={i}>
            <MemoRow memo={s.memos[0]} onOpen={onOpenMemo} badge={i + 1} meta={meta} />
          </li>
        )
      })}
    </ol>
  )
}

/**
 * 오늘 다녀온 곳: the day's photos as a route. In Korea the route is drawn on
 * a Kakao map; elsewhere a Google map picture is shown; with no key (or if
 * the map can't load) the keyless sketch is shown instead.
 */
export function Trail({ title, memos, home, onBack, onOpenMemo, keys = MAP_KEYS }: {
  title: string
  /** The photos of the day (or period) being shown. */
  memos: Memo[]
  home: LatLng | null
  onBack: () => void
  onOpenMemo: (memoId: string) => void
  keys?: MapKeys
}) {
  const stops = useMemo(() => trailStops(memos, home), [memos, home])
  const summary = trailSummary(stops)
  const mapRef = useRef<HTMLDivElement>(null)
  const [kakaoFailed, setKakaoFailed] = useState(false)
  // A Kakao map that fails to load gives way to the Google picture.
  const provider = pickProvider(stops, keys, KAKAO_USABLE && !kakaoFailed)
  const [staticFailed, setStaticFailed] = useState(false)
  // Home belongs in the picture on a day out, not on a trip far away.
  const nearHome = home && !summary.away && summary.maxKm !== null && summary.maxKm < AWAY_KM ? home : null

  useEffect(() => {
    if (provider !== 'kakao' || kakaoFailed || !mapRef.current || !keys.kakao || stops.length === 0) return
    let live = true
    renderKakaoMap(
      mapRef.current,
      keys.kakao,
      stops.map((s, i) => ({ lat: s.lat, lng: s.lng, label: String(i + 1), photoUrl: s.memos[0].photoUrl, onClick: () => onOpenMemo(s.memos[0].id) })),
      nearHome,
    ).catch((err) => {
      console.warn('[trail] kakao map unavailable; trying the Google picture', err)
      if (live) setKakaoFailed(true)
    })
    return () => { live = false }
    // The map is drawn once per set of stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, kakaoFailed, stops])

  const located = stops.reduce((n, s) => n + s.memos.length, 0)
  return (
    <section className="page trail">
      {/* The same frosted header as the photo page: back, the title, a spacer. */}
      <div className="detail-head">
        <button type="button" className="head-btn" onClick={onBack} aria-label="뒤로가기">‹</button>
        <div className="detail-head-when">{title}</div>
        <span className="head-btn-space" aria-hidden="true" />
      </div>
      <div className="h-eyebrow trail-summary">
        {stops.length > 0 ? `${stops.length}곳${summary.text ? ` · ${summary.text}` : ''}` : '위치가 있는 사진이 없어요'}
        {summary.away && <span className="trail-badge">여행 중</span>}
      </div>

      {stops.length === 0 ? (
        <div className="empty"><div>이 날은 위치가 기록된 사진이 없어요.</div></div>
      ) : (
        <>
          <div className="trail-map">
            {provider === 'kakao' && !kakaoFailed
              ? <div ref={mapRef} className="trail-kakao" />
              : provider === 'googleStatic' && keys.google && !staticFailed
                ? <img className="trail-static" src={staticMapUrl(stops, keys.google)} alt="다녀온 곳 지도" onError={() => setStaticFailed(true)} />
                : <TrailSketch stops={stops} home={nearHome} thumbs onPick={(s) => onOpenMemo(s.memos[0].id)} />}
          </div>
          <TrailList stops={stops} onOpenMemo={onOpenMemo} />
          {located < memos.length && <div className="help">위치가 없는 사진 {memos.length - located}장은 여기에 나오지 않아요.</div>}
        </>
      )}
    </section>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtTime } from '../util'
import { TrailSketch } from '../components/TrailSketch'
import { MAP_KEYS, pickProvider, type MapKeys } from '../lib/map'
import { staticMapUrl } from '../lib/map/googleStatic'
import { renderKakaoMap } from '../lib/map/kakao'
import { AWAY_KM, fmtKm, trailStops, trailSummary, type LatLng, type TrailStop } from '../lib/trail'
import type { Memo } from '../types'

/** What is shown under the map: each stop in order, with how far from home it was. */
export function TrailList({ stops, onOpenMemo }: { stops: TrailStop[]; onOpenMemo: (memoId: string) => void }) {
  return (
    <ol className="trail-list">
      {stops.map((s, i) => {
        const first = s.memos[0]
        return (
          <li key={i}>
            <button type="button" className="trail-stop" onClick={() => onOpenMemo(first.id)}>
              <span className="trail-n">{i + 1}</span>
              <span className="trail-thumb">{first.photoUrl && <img src={first.photoUrl} alt="" loading="lazy" />}</span>
              <span className="trail-body">
                <span className="when">{fmtTime(s.firstAt)}{s.area && ` · ${s.area}`}</span>
                <span className="act">{first.memo || first.activity || '사진'}</span>
                <span className="desc">
                  {[s.kmFromHome !== null ? (fmtKm(s.kmFromHome) === '집 근처' ? '집 근처' : `집에서 ${fmtKm(s.kmFromHome)}`) : '', s.memos.length > 1 ? `사진 ${s.memos.length}장` : ''].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * 오늘 다녀온 곳: the day's photos as a route. In Korea the route is drawn on
 * a Kakao map; elsewhere a Google map is fetched only when asked for; with
 * no key (or if the map can't load) the keyless sketch is shown instead.
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
  const provider = pickProvider(stops, keys)
  const mapRef = useRef<HTMLDivElement>(null)
  const [kakaoFailed, setKakaoFailed] = useState(false)
  const [showStatic, setShowStatic] = useState(false)
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
      console.warn('[trail] map unavailable; showing the sketch', err)
      if (live) setKakaoFailed(true)
    })
    return () => { live = false }
    // The map is drawn once per set of stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, kakaoFailed, stops])

  const located = stops.reduce((n, s) => n + s.memos.length, 0)
  return (
    <section className="page trail">
      <button className="back" onClick={onBack} aria-label="뒤로가기">‹ 뒤로</button>
      <div className="h-eyebrow">
        {stops.length > 0 ? `${stops.length}곳${summary.text ? ` · ${summary.text}` : ''}` : '위치가 있는 사진이 없어요'}
        {summary.away && <span className="trail-badge">여행 중</span>}
      </div>
      <h2 className="h-title">{title}</h2>

      {stops.length === 0 ? (
        <div className="empty"><div>이 날은 위치가 기록된 사진이 없어요.</div></div>
      ) : (
        <>
          <div className="trail-map">
            {provider === 'kakao' && !kakaoFailed
              ? <div ref={mapRef} className="trail-kakao" />
              : showStatic && keys.google
                ? <img className="trail-static" src={staticMapUrl(stops, keys.google)} alt="다녀온 곳 지도" />
                : <TrailSketch stops={stops} home={nearHome} thumbs onPick={(s) => onOpenMemo(s.memos[0].id)} />}
          </div>
          {provider === 'googleStatic' && !showStatic && (
            <button type="button" className="dg-more" onClick={() => setShowStatic(true)}>지도로 보기</button>
          )}
          <TrailList stops={stops} onOpenMemo={onOpenMemo} />
          {located < memos.length && <div className="help">위치가 없는 사진 {memos.length - located}장은 여기에 나오지 않아요.</div>}
        </>
      )}
    </section>
  )
}

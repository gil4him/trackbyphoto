import { useEffect, useRef, useState } from 'react'
import { KAKAO_IN_FRAME, MAP_KEYS, pickProvider, type MapKeys } from '../lib/map'
import { renderKakaoMap } from '../lib/map/kakao'
import { staticMapUrl } from '../lib/map/googleStatic'
import { KakaoFrame } from './KakaoFrame'
import type { LatLng } from '../lib/trail'
import { tr } from '../lib/lang'

/**
 * Where one photo was taken, on a map inside the app (사진 → 지도에서 보기).
 * The same rule as the day maps: Kakao in Korea (in the store apps through
 * the site's map page), Google elsewhere, and a Kakao map that fails gives
 * way to Google. Nothing opens another app: a parent who taps it stays here.
 * When no map can be drawn the box simply isn't shown.
 */
export function PlaceMap({ point, keys = MAP_KEYS }: { point: LatLng; keys?: MapKeys }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [kakaoFailed, setKakaoFailed] = useState(false)
  const [staticFailed, setStaticFailed] = useState(false)
  const provider = pickProvider([point], keys, !kakaoFailed)

  useEffect(() => {
    if (provider !== 'kakao' || KAKAO_IN_FRAME || !mapRef.current || !keys.kakao) return
    let live = true
    renderKakaoMap(mapRef.current, keys.kakao, [{ ...point, label: '' }], null).catch((err) => {
      console.warn('[photo] kakao map unavailable; trying the Google picture', err)
      if (live) setKakaoFailed(true)
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, point.lat, point.lng])

  if (provider === 'kakao') {
    return KAKAO_IN_FRAME
      ? <KakaoFrame className="place-map" map={{ key: keys.kakao!, pins: [{ ...point, label: '' }], home: null }} onFail={() => setKakaoFailed(true)} />
      : <div ref={mapRef} className="place-map" />
  }
  if (provider === 'googleStatic' && keys.google && !staticFailed) {
    return <img className="place-map" src={staticMapUrl([point], keys.google, { width: 640, height: 360 }, false)} alt={tr('찍은 곳 지도', 'Map of where the photo was taken')} onError={() => setStaticFailed(true)} />
  }
  return null
}

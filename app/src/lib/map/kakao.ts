// Kakao Map (JavaScript SDK): the route on a real map, for places in Korea.
// Uses the same JavaScript key as KakaoTalk sharing; the key only works on
// the site domains registered in the Kakao developers console.

import type { LatLng } from '../trail'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Kakao = any

const LOAD_TIMEOUT_MS = 8_000
let loading: Promise<Kakao> | null = null

/** Load the SDK once. Rejects when it can't be loaded (offline, key not
 *  allowed on this domain), so the caller can fall back to the sketch. */
export function loadKakaoMaps(key: string): Promise<Kakao> {
  loading ??= new Promise<Kakao>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('kakao maps timed out')), LOAD_TIMEOUT_MS)
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`
    script.async = true
    script.onload = () => {
      const kakao = (window as any).kakao
      if (!kakao?.maps?.load) { clearTimeout(timer); reject(new Error('kakao maps unavailable')); return }
      kakao.maps.load(() => { clearTimeout(timer); resolve(kakao) })
    }
    script.onerror = () => { clearTimeout(timer); reject(new Error('kakao maps failed to load')) }
    document.head.appendChild(script)
  }).catch((err) => {
    loading = null // let a later visit try again
    throw err
  })
  return loading
}

export interface MapPin extends LatLng {
  /** Order of the stop, shown on the pin. */
  label: string
  photoUrl?: string
  onClick?: () => void
}

/** Draw the route and its pins into `el`. */
export async function renderKakaoMap(el: HTMLElement, key: string, pins: MapPin[], home: LatLng | null): Promise<void> {
  const kakao = await loadKakaoMaps(key)
  const at = (p: LatLng) => new kakao.maps.LatLng(p.lat, p.lng)
  const map = new kakao.maps.Map(el, { center: at(pins[0]), level: 4 })

  if (pins.length > 1) {
    const bounds = new kakao.maps.LatLngBounds()
    pins.forEach((p) => bounds.extend(at(p)))
    map.setBounds(bounds, 56, 40, 40, 40)
    new kakao.maps.Polyline({ map, path: pins.map(at), strokeWeight: 4, strokeColor: '#FF6B2C', strokeOpacity: 0.9 })
  }
  if (home) {
    const el = document.createElement('div')
    el.className = 'trail-pin home'
    el.textContent = '집'
    new kakao.maps.CustomOverlay({ map, position: at(home), content: el, yAnchor: 0.5 })
  }
  pins.forEach((p) => {
    const pin = document.createElement('button')
    pin.type = 'button'
    pin.className = 'trail-pin'
    if (p.photoUrl) {
      const img = document.createElement('img')
      img.src = p.photoUrl
      img.alt = ''
      pin.appendChild(img)
    }
    const n = document.createElement('span')
    n.textContent = p.label
    pin.appendChild(n)
    if (p.onClick) pin.addEventListener('click', p.onClick)
    new kakao.maps.CustomOverlay({ map, position: at(p), content: pin, yAnchor: 1 })
  })
}

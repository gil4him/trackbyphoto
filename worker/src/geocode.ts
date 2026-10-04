import { logger } from './log.js'

// Reverse geocoding.
//
// Returns two strings:
//   place   — short label for lists: "Tiger Sugar · 강남고속버스터미널, 서초구"
//   address — full street address for the detail page:
//             "서울특별시 서초구 신반포로 194"
//
// Strategy:
//  1. If coords look Korean (lat 33–39, lng 124–132) AND a Kakao REST key is
//     set (KAKAO_REST_KEY in ~/.trackbyphoto/worker.env), Kakao Local gives
//     the exact road address and building name. Kakao's reverse lookup has no
//     shop names, so OpenStreetMap Nominatim runs alongside and contributes
//     the shop/landmark name ("Tiger Sugar") when it has one.
//  2. Otherwise Nominatim alone — free, no API key, global coverage.
//  3. If everything fails, return empty strings so the UI shows "위치 정보 없음" rather
//     than a fake Korean place name. (Previously a stub list of Korean
//     locations was returned even for US coords, which is what produced the
//     "한강공원 in USA" bug.)

function isLikelyKorea(lat: number, lng: number): boolean {
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132
}

export interface GeoResult {
  place: string
  address: string
}

const EMPTY: GeoResult = { place: '', address: '' }

/** A lookup that hangs must not hold up the memo queue. */
const TIMEOUT_MS = 8_000

/** OSM shop names sometimes carry a keyword list ("리김밥(고터) 김밥,떡볶이,…"); keep the name. */
function cleanName(name: string | undefined): string {
  const n = (name || '').trim()
  if (!n) return ''
  const cut = n.split(/[,，]/)[0].trim()
  return cut.length > 30 ? `${cut.slice(0, 30)}…` : cut
}

/**
 * True when two names likely mean the same place: one contains the other, or
 * they share a 4+ character ending ("서울고속버스터미널" / "강남고속버스터미널").
 */
function sameName(a: string, b: string): boolean {
  const x = a.replace(/\s/g, ''), y = b.replace(/\s/g, '')
  if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true
  let n = 0
  while (n < x.length && n < y.length && x[x.length - 1 - n] === y[y.length - 1 - n]) n++
  return n >= 4
}

/** "Name · 동, 구" — drops parts that are missing or repeat the name. */
function formatPlace(name: string, local: string | undefined, district: string | undefined): string {
  const area = [local, district].map((s) => (s || '').trim()).filter((s, i, a) => s && s !== name && a.indexOf(s) === i).join(', ')
  if (name && area) return `${name} · ${area}`
  return name || area
}

interface KakaoCoord2AddressDoc {
  address?: {
    region_1depth_name?: string
    region_2depth_name?: string
    region_3depth_name?: string
    address_name?: string
  }
  road_address?: { address_name?: string; building_name?: string }
}
interface KakaoCoord2AddressResponse {
  documents?: KakaoCoord2AddressDoc[]
}

interface KakaoParts {
  building: string
  dong: string
  district: string
  address: string
}

async function reverseGeocodeKakao(lat: number, lng: number, apiKey: string): Promise<KakaoParts> {
  const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${apiKey}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as KakaoCoord2AddressResponse
  const doc = data.documents?.[0]
  if (!doc) throw new Error('no documents')

  const parts = {
    building: cleanName(doc.road_address?.building_name),
    // region_3depth is the 법정동 ("반포동"); region_2depth the 구/시 ("서초구").
    dong: (doc.address?.region_3depth_name || '').trim(),
    district: (doc.address?.region_2depth_name || '').trim(),
    address: (doc.road_address?.address_name || doc.address?.address_name || '').trim(),
  }
  if (!parts.building && !parts.dong && !parts.address) throw new Error('no usable address fields')
  return parts
}

interface NominatimResponse {
  name?: string
  display_name?: string
  address?: {
    amenity?: string
    shop?: string
    leisure?: string
    tourism?: string
    building?: string
    park?: string
    office?: string
    house_number?: string
    road?: string
    neighbourhood?: string
    suburb?: string
    quarter?: string
    borough?: string
    city_district?: string
    county?: string
    village?: string
    town?: string
    city?: string
    province?: string
    state?: string
    country?: string
    country_code?: string
  }
}

/** GeoResult plus the shop/landmark name on its own, for merging with Kakao. */
interface NominatimResult extends GeoResult {
  poi: string
}

async function reverseGeocodeNominatim(lat: number, lng: number): Promise<NominatimResult> {
  // Nominatim usage policy requires a real User-Agent identifying the app.
  // Korean-language results when available (Accept-Language: ko, en).
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'TrackByPhoto/1.0 (https://trackbyphoto.web.app)',
      'Accept-Language': 'ko,en',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as NominatimResponse
  const a = data.address || {}

  // A named feature (cafe, park, building) leads; then the neighborhood
  // (Korea: 동 → suburb) and district (Korea: 구 → borough; US: city).
  const poi = cleanName(a.amenity || a.shop || a.leisure || a.tourism || a.office || a.park)
  const name = poi || cleanName(a.building || data.name)
  const local = a.neighbourhood || a.quarter || a.suburb || a.village
  const district = a.borough || a.city_district || a.town || a.city || a.county
  // Outside Korea a neighbourhood name means little to the family; the city
  // and country do ("FamilyMart · 도코나메시, 일본").
  const place = (a.country_code && a.country_code !== 'kr'
    ? formatPlace(name, a.city || a.town || a.village || a.county || a.state, a.country)
    : formatPlace(name, local, district)) || a.state || ''

  // Street address, most-general first in Korea ("서울특별시 서초구 신반포로 194"),
  // most-specific first elsewhere ("194 Main St, Palo Alto, CA").
  const street = a.road ? (a.house_number ? (a.country_code === 'kr' ? `${a.road} ${a.house_number}` : `${a.house_number} ${a.road}`) : a.road) : ''
  const city = a.city || a.town || a.village || a.province || a.state
  const borough = a.borough || a.city_district
  const address = a.country_code === 'kr'
    ? [city, borough, street || local].filter(Boolean).join(' ')
    : [street || local, a.city || a.town || a.village, a.state].filter(Boolean).join(', ')

  if (!place && !address) {
    if (data.display_name) {
      const short = data.display_name.split(',').slice(0, 2).map((s) => s.trim()).join(', ')
      return { place: short, address: data.display_name, poi }
    }
    throw new Error('no usable address fields')
  }
  return { place: place || address, address, poi }
}

export async function reverseGeocode(lat: number | null, lng: number | null): Promise<GeoResult> {
  if (lat == null || lng == null) return EMPTY

  const kakaoKey = process.env.KAKAO_REST_KEY || ''
  if (kakaoKey && isLikelyKorea(lat, lng)) {
    const [kakao, osm] = await Promise.allSettled([
      reverseGeocodeKakao(lat, lng, kakaoKey),
      reverseGeocodeNominatim(lat, lng),
    ])
    if (kakao.status === 'fulfilled') {
      const k = kakao.value
      let poi = osm.status === 'fulfilled' ? osm.value.poi : ''
      // OSM and Kakao naming the same landmark: keep Kakao's official name.
      if (poi && k.building && sameName(poi, k.building)) poi = ''
      // "Tiger Sugar · 강남고속버스터미널, 서초구" when both names exist,
      // else "강남고속버스터미널 · 반포동, 서초구", else "반포동, 서초구".
      const place = poi
        ? formatPlace(poi, k.building || k.dong, k.district)
        : formatPlace(k.building, k.dong, k.district)
      return { place: place || k.address, address: k.address }
    }
    logger.warn('[reverseGeocode] Kakao failed; falling back to Nominatim', { err: String(kakao.reason), lat, lng })
    if (osm.status === 'fulfilled') return { place: osm.value.place, address: osm.value.address }
  }

  try {
    const { place, address } = await reverseGeocodeNominatim(lat, lng)
    return { place, address }
  } catch (err) {
    logger.warn('[reverseGeocode] Nominatim failed; returning empty', { err: String(err), lat, lng })
    return EMPTY
  }
}

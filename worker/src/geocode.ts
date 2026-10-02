import { logger } from './log.js'

// Reverse geocoding.
//
// Returns two strings:
//   place   — short label for lists: "Tiger Sugar · 반포4동, 서초구"
//   address — full street address for the detail page:
//             "서울특별시 서초구 신반포로 194"
//
// Strategy:
//  1. If coords look Korean (lat 33–39, lng 124–132) AND a Kakao REST key is
//     set, hit Kakao Local — best Korean building/dong names. Set the key via
//     the worker env (KAKAO_REST_KEY=... in the launchd plist / worker/.env).
//  2. Otherwise hit OpenStreetMap Nominatim — free, no API key, global
//     coverage. Pulls a short, human-readable name from the address parts.
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

/** OSM shop names sometimes carry a keyword list ("리김밥(고터) 김밥,떡볶이,…"); keep the name. */
function cleanName(name: string | undefined): string {
  const n = (name || '').trim()
  if (!n) return ''
  const cut = n.split(/[,，]/)[0].trim()
  return cut.length > 30 ? `${cut.slice(0, 30)}…` : cut
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

async function reverseGeocodeKakao(lat: number, lng: number, apiKey: string): Promise<GeoResult> {
  const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${apiKey}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as KakaoCoord2AddressResponse
  const doc = data.documents?.[0]
  if (!doc) throw new Error('no documents')

  // region_2depth ("강남구", "성남시") + region_3depth ("역삼동") are what
  // family members recognize; the building name, when Kakao has one, leads.
  const place = formatPlace(
    cleanName(doc.road_address?.building_name),
    doc.address?.region_3depth_name,
    doc.address?.region_2depth_name,
  )
  const address = (doc.road_address?.address_name || doc.address?.address_name || '').trim()
  if (!place && !address) throw new Error('no usable address fields')
  return { place: place || address, address }
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

async function reverseGeocodeNominatim(lat: number, lng: number): Promise<GeoResult> {
  // Nominatim usage policy requires a real User-Agent identifying the app.
  // Korean-language results when available (Accept-Language: ko, en).
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'TrackByPhoto/1.0 (https://trackbyphoto.web.app)',
      'Accept-Language': 'ko,en',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as NominatimResponse
  const a = data.address || {}

  // A named feature (cafe, park, building) leads; then the neighborhood
  // (Korea: 동 → suburb) and district (Korea: 구 → borough; US: city).
  const name = cleanName(a.amenity || a.shop || a.leisure || a.tourism || a.office || a.building || a.park || data.name)
  const local = a.neighbourhood || a.quarter || a.suburb || a.village
  const district = a.borough || a.city_district || a.town || a.city || a.county
  const place = formatPlace(name, local, district) || a.state || ''

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
      return { place: short, address: data.display_name }
    }
    throw new Error('no usable address fields')
  }
  return { place: place || address, address }
}

export async function reverseGeocode(lat: number | null, lng: number | null): Promise<GeoResult> {
  if (lat == null || lng == null) return EMPTY

  const kakaoKey = process.env.KAKAO_REST_KEY || ''
  if (kakaoKey && isLikelyKorea(lat, lng)) {
    try {
      return await reverseGeocodeKakao(lat, lng, kakaoKey)
    } catch (err) {
      logger.warn('[reverseGeocode] Kakao failed; falling back to Nominatim', { err: String(err), lat, lng })
    }
  }

  try {
    return await reverseGeocodeNominatim(lat, lng)
  } catch (err) {
    logger.warn('[reverseGeocode] Nominatim failed; returning empty', { err: String(err), lat, lng })
    return EMPTY
  }
}

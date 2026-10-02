import { logger } from './log.js'

// Reverse geocoding.
//
// Strategy:
//  1. If coords look Korean (lat 33–39, lng 124–132) AND a Kakao REST key is
//     set, hit Kakao Local — best Korean building/dong names. Set the key via
//     the worker env (KAKAO_REST_KEY=... in the launchd plist / worker/.env).
//  2. Otherwise hit OpenStreetMap Nominatim — free, no API key, global
//     coverage. Pulls a short, human-readable name from the address parts.
//  3. If everything fails, return '' so the UI shows "위치 정보 없음" rather
//     than a fake Korean place name. (Previously a stub list of Korean
//     locations was returned even for US coords, which is what produced the
//     "한강공원 in USA" bug.)

function isLikelyKorea(lat: number, lng: number): boolean {
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132
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

async function reverseGeocodeKakao(lat: number, lng: number, apiKey: string): Promise<string> {
  const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${apiKey}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as KakaoCoord2AddressResponse
  const doc = data.documents?.[0]
  if (!doc) throw new Error('no documents')

  // Region_2depth ("강남구", "성남시") gives the city/gu suffix that family
  // members will recognize. Pair it with the most specific name we have
  // (building → dong → road) so the output is "성모병원, 강남구".
  const city = doc.address?.region_2depth_name?.trim()
  const join = (name: string) => (city && city !== name ? `${name}, ${city}` : name)

  const building = doc.road_address?.building_name?.trim()
  if (building) return join(building)
  const dong = doc.address?.region_3depth_name?.trim()
  if (dong) return join(dong)
  const road = doc.road_address?.address_name?.trim()
  if (road) return road
  if (city) return city
  throw new Error('no usable address fields')
}

interface NominatimResponse {
  display_name?: string
  address?: {
    amenity?: string
    shop?: string
    leisure?: string
    tourism?: string
    building?: string
    park?: string
    road?: string
    neighbourhood?: string
    suburb?: string
    quarter?: string
    village?: string
    town?: string
    city?: string
    state?: string
    country?: string
  }
}

async function reverseGeocodeNominatim(lat: number, lng: number): Promise<string> {
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

  // Always pair the specific name with the surrounding city / town / state
  // so guardians get both context lines: "Starbucks, San Francisco" rather
  // than just "Starbucks". Falls back gracefully when only one part is
  // available.
  const cityish = a.city || a.town || a.village || a.suburb || a.state
  const join = (name: string) => (cityish && cityish !== name ? `${name}, ${cityish}` : name)

  // Prefer a specific named feature (cafe, park, building) over the broader
  // neighborhood/city.
  const specific = a.amenity || a.shop || a.leisure || a.tourism || a.building || a.park
  if (specific) return join(specific)
  const local = a.neighbourhood || a.suburb || a.quarter
  if (local) return join(local)
  if (cityish) return cityish
  if (a.road) return join(a.road)
  if (data.display_name) {
    // Nominatim's display_name is a long comma-separated chain; first two
    // parts are usually the most specific and recognizable.
    return data.display_name.split(',').slice(0, 2).map((s) => s.trim()).join(', ')
  }
  throw new Error('no usable address fields')
}

export async function reverseGeocode(lat: number | null, lng: number | null): Promise<string> {
  if (lat == null || lng == null) return ''

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
    return ''
  }
}

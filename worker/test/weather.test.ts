// WeatherKit: the words, the prompt line, and a lookup against a fake server.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { generateKeyPairSync, verify } from 'node:crypto'
import { feelOf, weatherAt, weatherOf, weatherText } from '../src/weather'
import { momentLines } from '../src/llm/moment'
import { buildPrompt } from '../src/llm/prompt'

describe('weather words', () => {
  it('turns a code and a temperature into Korean', () => {
    expect(weatherOf('Clear', 23.6)).toEqual({ code: 'Clear', label: '맑음', tempC: 24, feel: '따뜻한 날' })
    expect(feelOf(9)).toBe('쌀쌀한 날')
    expect(weatherText(weatherOf('Rain', 9))).toBe('비, 9°C (쌀쌀한 날)')
    expect(weatherText(weatherOf('Unknown', 30))).toBe('30°C (더운 날)')
  })

  it('tells the model the real weather, or to leave weather out', () => {
    expect(momentLines({ timeHint: '13:34', weather: weatherOf('Clear', 24) }).join('\n')).toContain('- 날씨 (그 시각 실제 기록): 맑음, 24°C (따뜻한 날)')
    expect(momentLines({ timeHint: '13:34' }).join('\n')).toContain('- 날씨: 알 수 없음 → 날씨는 쓰지 마세요.')
    const p = buildPrompt({ timeHint: '13:34', weather: weatherOf('Clear', 24) }, 'cloud')
    expect(p).toContain('불국사에 다녀오셨어요!')
    expect(p).toContain('사진의 빛이나 하늘을 보고 날씨를 짐작하지 마세요')
  })
})

describe('WeatherKit lookup', () => {
  let server: Server
  let seen: { url: string; auth: string }[] = []
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url ?? '', auth: req.headers.authorization ?? '' })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ forecastHourly: { hours: [{ conditionCode: 'MostlyClear', temperature: 18.4 }] } }))
    })
    await new Promise<void>((r) => server.listen(0, r))
    process.env.WEATHERKIT_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.close()
    for (const k of ['WEATHERKIT_BASE_URL', 'WEATHERKIT_TEAM_ID', 'WEATHERKIT_KEY_ID', 'WEATHERKIT_SERVICE_ID', 'WEATHERKIT_KEY']) delete process.env[k]
  })

  it('returns null when not configured', async () => {
    expect(await weatherAt(37.5, 127, new Date())).toBeNull()
    expect(seen).toHaveLength(0)
  })

  it('asks for the hour of the photo with a signed token, and caches it', async () => {
    process.env.WEATHERKIT_TEAM_ID = 'TEAM123456'
    process.env.WEATHERKIT_KEY_ID = 'KEY1234567'
    process.env.WEATHERKIT_SERVICE_ID = 'com.example.app'
    process.env.WEATHERKIT_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const at = new Date('2026-10-18T20:34:00Z')
    expect(await weatherAt(33.8616, -117.9987, at)).toEqual({ code: 'MostlyClear', label: '대체로 맑음', tempC: 18, feel: '선선한 날' })
    expect(seen[0].url).toContain('/api/v1/weather/ko/33.8616/-117.9987?dataSets=forecastHourly&hourlyStart=2026-10-18T20:00:00.000Z&hourlyEnd=2026-10-18T21:00:00.000Z')
    const [h, p, sig] = seen[0].auth.replace('Bearer ', '').split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567', id: 'TEAM123456.com.example.app' })
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toMatchObject({ iss: 'TEAM123456', sub: 'com.example.app' })
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true)
    await weatherAt(33.8616, -117.9987, new Date('2026-10-18T20:50:00Z'))
    expect(seen).toHaveLength(1)
  })
})

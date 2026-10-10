// The two legal pages (legal/README.md): shipped by the simple build only,
// served at /privacy and /terms as their own static HTML, and never answered
// from the cached app shell.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Plugin, UserConfig } from 'vite'
import config from '../../vite.config'

const read = (name: string) =>
  readFileSync(new URL(`../../legal/${name}`, import.meta.url), 'utf8')

const privacy = read('privacy.html')
const terms = read('terms.html')
const firebaseJson = JSON.parse(
  readFileSync(new URL('../../../firebase.json', import.meta.url), 'utf8'),
) as { hosting: { target: string; rewrites?: { source: string; destination: string }[] }[] }

/** The built config for one edition. `config` is defineConfig's own function. */
function buildConfig(mode: string): UserConfig {
  const factory = config as unknown as (env: {
    mode: string
    command: 'build'
  }) => UserConfig
  return factory({ mode, command: 'build' })
}

function plugins(mode: string): Plugin[] {
  const out: Plugin[] = []
  const walk = (option: unknown) => {
    if (Array.isArray(option)) option.forEach(walk)
    else if (option && typeof option === 'object' && 'name' in option) out.push(option as Plugin)
  }
  walk(buildConfig(mode).plugins)
  return out
}

/** Run a plugin's generateBundle and collect the files it emitted. */
function emitted(mode: string, pluginName: string): string[] {
  const plugin = plugins(mode).find((p) => p.name === pluginName)
  if (!plugin) throw new Error(`no ${pluginName} plugin for mode ${mode}`)
  const names: string[] = []
  const hook = plugin.generateBundle
  const fn = typeof hook === 'function' ? hook : hook?.handler
  if (!fn) throw new Error(`${pluginName} has no generateBundle`)
  const ctx = { emitFile: (file: { fileName?: string }) => { if (file.fileName) names.push(file.fileName) } }
  ;(fn as (this: unknown, ...args: unknown[]) => void).call(ctx, {}, {}, {})
  return names
}

describe('legal pages in the build', () => {
  it('the simple build emits both pages', () => {
    expect(emitted('simple', 'daylie-legal')).toEqual(['privacy.html', 'terms.html'])
  })

  it('the full build (TrackByPhoto) ships neither', () => {
    expect(emitted('production', 'daylie-legal')).toEqual([])
  })

  it('the app shell never answers for /privacy or /terms', () => {
    const pwa = plugins('simple').find((p) => p.name === 'vite-plugin-pwa')
    // The plugin's own options aren't readable from the instance, so assert on
    // the denylist we hand it; keep this in step with vite.config.ts.
    const denylist = [/^\/__\//, /^\/(privacy|terms)\/?$/]
    expect(pwa).toBeTruthy()
    for (const path of ['/privacy', '/privacy/', '/terms', '/terms/']) {
      expect(denylist.some((re) => re.test(path))).toBe(true)
    }
    expect(denylist.some((re) => re.test('/'))).toBe(false)
    expect(denylist.some((re) => re.test('/pair'))).toBe(false)
    expect(readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8'))
      .toContain('/^\\/(privacy|terms)\\/?$/')
  })
})

describe('hosting serves them as their own pages', () => {
  const app = firebaseJson.hosting.find((h) => h.target === 'app')
  const rewrites = app?.rewrites ?? []

  it('rewrites each path to its static file ahead of the SPA catch-all', () => {
    const spa = rewrites.findIndex((r) => r.source === '**')
    expect(spa).toBeGreaterThan(0)
    for (const [source, destination] of [
      ['/privacy', '/privacy.html'],
      ['/privacy/', '/privacy.html'],
      ['/terms', '/terms.html'],
      ['/terms/', '/terms.html'],
    ]) {
      const at = rewrites.findIndex((r) => r.source === source)
      expect(at, `${source} is rewritten`).toBeGreaterThanOrEqual(0)
      expect(at).toBeLessThan(spa)
      expect(rewrites[at].destination).toBe(destination)
    }
  })
})

describe('what each page has to say', () => {
  it('needs no JavaScript', () => {
    for (const html of [privacy, terms]) expect(html).not.toMatch(/<script/i)
  })

  it('is a Korean mobile page carrying the app name', () => {
    for (const html of [privacy, terms]) {
      expect(html).toContain('<html lang="ko">')
      expect(html).toContain('name="viewport"')
      expect(html).toContain('오늘하루')
      expect(html).toContain('2026년 10월 10일')
    }
  })

  it('links to the other page and to the contact address', () => {
    expect(privacy).toContain('href="/terms"')
    expect(terms).toContain('href="/privacy"')
    for (const html of [privacy, terms]) expect(html).toContain('gil4him@gmail.com')
  })

  it('the privacy policy covers every section 개인정보 보호법 asks for', () => {
    for (const section of [
      '개인정보처리방침',
      '수집하는 개인정보',
      '이용 목적',
      '보유 기간',
      '제3자',
      '국외 이전',
      '이용자의 권리',
      '만 14세',
      '파기',
      '안전성 확보',
    ]) {
      expect(privacy, section).toContain(section)
    }
  })

  it('the privacy policy names what the app actually collects', () => {
    for (const item of ['사진', '위치', '장소명', '푸시', '하트', '가족']) {
      expect(privacy, item).toContain(item)
    }
  })

  it('the terms cover the service, the family consent and the AI memos', () => {
    for (const section of [
      '이용약관',
      '서비스 내용',
      '계정',
      '이용자 콘텐츠',
      '가족 공유',
      '금지',
      'AI',
      '서비스의 변경',
      '책임',
      '준거법',
    ]) {
      expect(terms, section).toContain(section)
    }
  })

  it('never promises anything medical', () => {
    for (const html of [privacy, terms]) {
      expect(html).not.toMatch(/치매 (진단|판정)|의학적 (진단|판단)|질병을 진단/)
    }
  })

  it('marks what is still open with 확인 필요', () => {
    for (const html of [privacy, terms]) expect(html).toContain('[확인 필요]')
  })
})

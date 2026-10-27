// The English memo prompt and its post-processing (US 1.1): the same memory
// diary in English, with `activity` still a Korean category key, and the
// Korean prompt left exactly as it was.

import { describe, it, expect } from 'vitest'
import {
  buildPrompt,
  diaryOpener,
  dropFeelingWords,
  isBackgroundSentence,
  parseModelResponse,
  tidyMemo,
  tidyScene,
  VALID_CATEGORIES,
} from '../src/llm/prompt'
import { momentLines, weatherTextEn } from '../src/llm/moment'
import { dateHintAt } from '../src/travel'
import { bigramSimilarity, checkMemo } from '../src/llm/guards'
import { weatherOf } from '../src/weather'

const HANGUL = /[가-힣]/

describe('the English prompt', () => {
  it('writes every rule section in English', () => {
    const p = buildPrompt({ lang: 'en' })
    expect(p).toContain('guess (write this first, one line):')
    expect(p).toContain('Common rules:')
    expect(p).toContain('Text in the background:')
    expect(p).toContain('memo (the title, one line, 4 to 8 words) — what they did + where:')
    expect(p).toContain('scene (a one-line diary that brings the day back, 1 sentence · 2 at most · under 90 characters):')
    expect(p).toContain('activity (exactly one, for what they were doing):')
    expect(p).toContain('Examples:')
    expect(p).toContain('Context (the time is a fact, the rest is for reference')
    expect(p).toContain('Answer with JSON only. No other text:')
  })

  it('keeps the approved title and scene shapes', () => {
    const p = buildPrompt({ lang: 'en' })
    expect(p).toContain('"Walked the neighborhood park early"')
    expect(p).toContain('"Lunch with kalguksu at a restaurant"')
    expect(p).toContain('"Waiting to board at the airport"')
    expect(p).toContain('"Visited Bulguksa Temple!"')
    expect(p).toContain('A clear, warm Sunday, stepping out after lunch for a photo with the group.')
    expect(p).toContain('A clear, cool Monday morning, starting the day with a lap around the park.')
    // No feelings, no inventory of the background.
    expect(p).toContain('Never invent a feeling ("delicious", "lovely", "happy", "pretty")')
    expect(p).toContain('"A glass of water is on the table"')
    expect(p).toContain('Write the weather only from the real values in the context.')
  })

  it('has no Korean in it but the category words', () => {
    for (const variant of ['local', 'cloud'] as const) {
      for (const line of buildPrompt({ lang: 'en' }, variant).split('\n').filter((l) => HANGUL.test(l))) {
        const category = VALID_CATEGORIES.some((c) => line.startsWith(`- ${c} (`) || line.includes(`"${c}"`))
        // The two rules that exist to turn Korean into English quote Korean on purpose.
        const translationRule = line.includes('가장 큰 축제') || line.includes('한양식당')
        expect(category || translationRule, line).toBe(true)
      }
    }
  })

  it('tells the model the activity stays one of the Korean words', () => {
    const p = buildPrompt({ lang: 'en' })
    expect(p).toContain('The value must be one of these 13 Korean words, copied exactly as written and never translated. Everything else you write (guess, memo, scene) is in English.')
    for (const c of VALID_CATEGORIES) expect(p).toContain(`- ${c} (`)
    expect(p).toContain('"activity":"<one of the 13 Korean category words>"')
    expect(p).toContain('"activity":"식사"')
  })

  it('writes the context lines in English, miles and Fahrenheit', () => {
    const p = buildPrompt({
      lang: 'en',
      timeHint: '07:10',
      dayHint: 'Monday',
      sunHint: { rise: '06:41', set: '17:51' },
      weather: weatherOf('MostlyClear', 17),
      placeHint: 'Buena Park, US',
      homeHint: { km: 900, away: true, homeArea: 'Palo Alto, US' },
      placeFull: 'Han Yang Restaurant · Buena Park, US',
      coords: { lat: 33.8, lng: -117.99 },
      textHint: ['Aichi-Nagoya 2026'],
      todayHint: ['06:50 · 산책 · Walked the park by the house · Seocho-dong'],
    }, 'cloud')
    expect(p).toContain('- Time taken: Monday morning 07:10')
    expect(p).toContain('→ Sunrise that day 06:41, sunset 17:51. The photo was taken in the morning, shortly after sunrise.')
    expect(p).toContain('- Weather (the real record for that hour): mostly clear, 63°F (17°C), a cool day')
    expect(p).toContain('- Photos taken earlier today (oldest first, time · category · note · area):')
    expect(p).toContain('- Area: Buena Park, US')
    expect(p).toContain('- Distance from home: about 560 miles from home (Palo Alto, US).')
    expect(p).toContain('- Nearest place on the map: Han Yang Restaurant · Buena Park, US')
    expect(p).toContain('- Coordinates: 33.80000, -117.99000')
    expect(p).toContain('- Text the phone read in the photo: "Aichi-Nagoya 2026"')
    for (const korean of ['찍은 때', '- 지역:', '날씨', '집과의 거리', '지도에서 가장 가까운 곳', '휴대폰이 사진에서 읽은 글자']) {
      expect(p).not.toContain(korean)
    }
  })

  it('says in English when the time, the weather or the place is unknown', () => {
    const p = buildPrompt({ lang: 'en' })
    expect(p).toContain('- Time taken: unknown')
    expect(p).toContain('- Weather: unknown → do not write about the weather.')
    expect(p).toContain('- Area: unknown')
  })

  it('borrows a nearby photo\'s place in English, without the nearest-place block', () => {
    const p = buildPrompt({ lang: 'en', placeHint: 'Nagoya, Japan', nearHint: true, placeFull: 'Kura Sushi · Nishi-Shinjuku' })
    expect(p).toContain('- Area: near Nagoya, Japan (this photo has no location of its own;')
    expect(p).not.toContain('Nearest place on the map')
  })

  it('keeps the local/cloud difference', () => {
    const local = buildPrompt({ lang: 'en' })
    const cloud = buildPrompt({ lang: 'en' }, 'cloud')
    expect(local).toContain('Never transcribe or translate Japanese or Chinese characters')
    expect(cloud).toContain('"新宿駅" → "Shinjuku Station"')
    expect(cloud).toContain('"한양식당" → "Hanyang Restaurant"')
    expect(local).not.toContain('→ "Hanyang Restaurant"')
    expect(cloud).toContain('You may use the name of an area, a station or a street that you know from the coordinates.')
  })

  it('writes the diary variant in English too', () => {
    const p = buildPrompt({ lang: 'en', diary: true, dateHint: 'October 18, afternoon', placeHint: 'Jamsil' })
    expect(p).toContain('scene (a short diary of that moment, 3 or 4 sentences):')
    expect(p).toContain('The app puts the date and the area in front.')
  })

  it('leaves the Korean prompt exactly as it was', () => {
    for (const variant of ['local', 'cloud'] as const) {
      const ko = buildPrompt({}, variant)
      expect(ko).toBe(buildPrompt({ lang: 'ko' }, variant))
      expect(ko).toContain('공통 규칙:')
      expect(ko).toContain('scene (그날을 기억하게 하는 한 줄 일기, 1문장 · 많아야 2문장 · 50자 이내):')
      expect(ko).toContain('JSON만 출력하세요. 다른 텍스트 금지:')
      expect(ko).not.toContain('Common rules:')
      expect(ko).not.toContain('Walked the neighborhood park early')
    }
    const ko = buildPrompt({ timeHint: '07:10', weather: weatherOf('Clear', 17), homeHint: { km: 900, away: true } })
    expect(ko).toContain('- 날씨 (그 시각 실제 기록): 맑음, 17°C (선선한 날)')
    expect(ko).toContain('집에서 약 900km 떨어진 곳이에요')
    expect(ko).not.toContain('miles')
  })
})

describe('the English moment lines', () => {
  it('are English only when the language is', () => {
    expect(momentLines({ timeHint: '13:34', weather: weatherOf('Clear', 24) }).join('\n')).toContain('- 날씨 (그 시각 실제 기록): 맑음, 24°C (따뜻한 날)')
    const en = momentLines({ lang: 'en', timeHint: '13:34', weather: weatherOf('Clear', 24) }).join('\n')
    expect(en).toContain('- Time taken: afternoon 13:34')
    expect(en).toContain('- Weather (the real record for that hour): clear, 75°F (24°C), a warm day')
    expect(en).not.toMatch(HANGUL)
    expect(momentLines({ lang: 'en', timeHint: '13:34', todayHint: ['x'] }, { guess: false }).join('\n')).not.toContain('x')
  })

  it('names an unknown WeatherKit code in words', () => {
    expect(weatherTextEn(weatherOf('BlowingDust', 31))).toBe('blowing dust, 88°F (31°C), a hot day')
  })
})

describe('the English diary opener', () => {
  it('reads "October 18, afternoon, in Jamsil."', () => {
    expect(diaryOpener('October 18, afternoon', 'Jamsil, Songpa-gu', 'en')).toBe('October 18, afternoon, in Jamsil.')
    expect(diaryOpener('October 18, afternoon', undefined, 'en')).toBe('October 18, afternoon.')
    expect(diaryOpener(undefined, 'Jamsil', 'en')).toBe('In Jamsil.')
    expect(diaryOpener(undefined, undefined, 'en')).toBe('')
    // Korean unchanged.
    expect(diaryOpener('10월 18일 오후', '잠실동, 송파구')).toBe('10월 18일 오후, 잠실동에서.')
  })

  it('builds an English date hint', () => {
    expect(dateHintAt(new Date('2026-10-18T14:20:00Z'), 'en')).toBe('October 18, afternoon')
    expect(dateHintAt(new Date('2026-10-18T07:20:00Z'), 'en')).toBe('October 18, morning')
    expect(dateHintAt(new Date('2026-10-18T14:20:00Z'))).toBe('10월 18일 오후')
  })
})

describe('English post-processing', () => {
  it('drops the feeling words only for English', () => {
    expect(dropFeelingWords('A clear Sunday, they leisurely had a delicious lunch with the group.', 'en'))
      .toBe('A clear Sunday, they had lunch with the group.')
    expect(dropFeelingWords('Delicious lunch at a restaurant', 'en')).toBe('Lunch at a restaurant')
    // A warm, clear day is a WeatherKit fact, not a feeling.
    expect(dropFeelingWords('A clear, warm Sunday, lunch with the group.', 'en'))
      .toBe('A clear, warm Sunday, lunch with the group.')
    // The English list never touches a Korean scene.
    expect(dropFeelingWords('맑은 일요일, 일행과 즐겁게 점심을 드셨어요.')).toBe('맑은 일요일, 일행과 점심을 드셨어요.')
    expect(dropFeelingWords('A delicious lunch')).toBe('A delicious lunch')
  })

  it('knows an English background sentence', () => {
    for (const s of [
      'A glass of water is on the table.',
      'Trees line the path.',
      'Shops can be seen behind them.',
      'A white car is parked outside.',
      'There are snacks on the shelves.',
      'In the background a building rises.',
    ]) expect(isBackgroundSentence(s, 'en'), s).toBe(true)
    for (const s of [
      'A clear, warm Sunday, lunch with the group.',
      'A photo in front of Dabotap in Gyeongju.',
      'The banner behind them reads "Jinhae cherry blossom festival".',
    ]) expect(isBackgroundSentence(s, 'en'), s).toBe(false)
    // Korean rules are not applied to English and the other way round.
    expect(isBackgroundSentence('Trees line the path.')).toBe(false)
    expect(isBackgroundSentence('뒤로 상점들이 보여요.', 'en')).toBe(false)
  })

  it('does not mangle an English title', () => {
    expect(tidyMemo('Lunch with kalguksu at a restaurant', 'en')).toBe('Lunch with kalguksu at a restaurant')
    expect(tidyMemo('  "Visited Bulguksa Temple!" ', 'en')).toBe('Visited Bulguksa Temple!')
    expect(tidyMemo('Walked the neighborhood park early.', 'en')).toBe('Walked the neighborhood park early')
    const long = tidyMemo('Waiting to board the plane at the airport after a long morning in the terminal', 'en')
    expect(long.length).toBeLessThanOrEqual(71)
    expect(long.endsWith('…')).toBe(true)
    expect(long.startsWith('Waiting to board the plane at the airport after a long morning')).toBe(true)
    // Korean unchanged.
    expect(tidyMemo('한양식당에서 곤드레돌솥밥을 드셨어요')).toBe('한양식당에서 곤드레돌솥밥을 드셨어요')
  })

  it('tidies an English scene by sentence', () => {
    expect(tidyScene('A clear, warm Sunday, lunch with the group. Shops can be seen behind them.', false, false, 'en'))
      .toBe('A clear, warm Sunday, lunch with the group.')
    expect(tidyScene('A rainy Monday morning, they comfortably spent the day at home.', false, false, 'en'))
      .toBe('A rainy Monday morning, they spent the day at home.')
    // The first sentence is kept even when it describes the background.
    expect(tidyScene('A glass of water is on the table.', false, false, 'en'))
      .toBe('A glass of water is on the table.')
    expect(tidyScene('Friday morning, landing in Nagoya. Picked out a snack at the airport.', false, false, 'en'))
      .toBe('Friday morning, landing in Nagoya. Picked out a snack at the airport.')
    // Korean path untouched.
    expect(tidyScene('일요일 오후, 건물 앞에서 사진을 찍으셨어요. 뒤로 상업 시설들이 보입니다.'))
      .toBe('일요일 오후, 건물 앞에서 사진을 찍으셨어요.')
  })

  it('parses an English answer and snaps the activity', () => {
    const out = parseModelResponse(JSON.stringify({
      guess: 'stone pot rice + Sunday lunchtime + Hanyang Restaurant → lunch with the group',
      activity: '식사',
      memo: 'Gondre rice bowl at Hanyang Restaurant',
      scene: 'A clear, warm Sunday, lunch with the group.',
    }), { lang: 'en', relaxed: true })
    expect(out).toEqual({
      activity: '식사',
      memo: 'Gondre rice bowl at Hanyang Restaurant',
      scene: 'A clear, warm Sunday, lunch with the group.',
      guess: 'stone pot rice + Sunday lunchtime + Hanyang Restaurant → lunch with the group',
    })
    // An English category word is not one of ours: 기타, like any other drift.
    expect(parseModelResponse('{"activity":"meal","memo":"Lunch at home","scene":"A rainy Tuesday."}', { lang: 'en' })?.activity).toBe('기타')
    // A long English title is kept whole, not cut at 40 characters.
    expect(parseModelResponse('{"activity":"모임","memo":"A photo together after lunch at Hanyang","scene":""}', { lang: 'en' })?.memo)
      .toBe('A photo together after lunch at Hanyang')
  })
})

describe('checkMemo in English', () => {
  const facts = { texts: ['a park path', 'cherry trees', 'Seocho-dong', 'Monday', '3 people', '63°F'] }
  const hooks = ['nth', 'calendar', 'weather']

  it('accepts a normal English title', () => {
    expect(checkMemo('Walked the neighborhood park early', 'nth', facts, hooks, ['Picking fruit at the market'], 'A clear, cool Monday morning, a lap around the park.', 'en')).toEqual({ ok: true })
    expect(checkMemo('Cherry trees on the Seocho-dong park path', null, facts, hooks, [], '', 'en')).toEqual({ ok: true })
  })

  it('still refuses a guessed relationship or an invented number', () => {
    expect(checkMemo('A walk with his daughter', null, facts, hooks, [], '', 'en')).toMatchObject({ ok: false, reason: 'relation', detail: 'daughter' })
    expect(checkMemo('A walk under the trees', null, facts, hooks, [], 'Their grandson came along.', 'en')).toMatchObject({ ok: false, reason: 'relation', detail: 'grandson' })
    expect(checkMemo('A walk with 12 cherry trees', null, facts, hooks, [], '', 'en')).toMatchObject({ ok: false, reason: 'number', detail: '12' })
    expect(checkMemo('A walk with 3 people', null, facts, hooks, [], '', 'en')).toEqual({ ok: true })
  })

  it('measures "too similar" by word, not by character bigrams', () => {
    // Two different English titles share their bigrams ("the", "ed ", "ar"),
    // which is why the English path compares words.
    const a = 'Walked the neighborhood park early'
    const b = 'Walked the park with the group'
    expect(bigramSimilarity(a, b)).toBeGreaterThan(0.4)
    expect(checkMemo(a, null, facts, hooks, [b], '', 'en')).toEqual({ ok: true })
    expect(checkMemo(a, null, facts, hooks, ['Walked the neighborhood park early'], '', 'en'))
      .toMatchObject({ ok: false, reason: 'similar' })
  })

  it('leaves the Korean guards alone', () => {
    expect(checkMemo('가족과 벚꽃 산책', null, { texts: ['벚꽃', '공원 길'] }, hooks, [])).toMatchObject({ ok: false, reason: 'relation', detail: '가족' })
  })
})

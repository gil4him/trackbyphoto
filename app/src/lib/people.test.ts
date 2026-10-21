import { describe, it, expect } from 'vitest'
import { addressed, consentButtonLabel, honorific, honorificWith, listedPeople, nameTaken, pickActivePatient, sameName, sentToName } from './people'

describe('who is listed', () => {
  const links = [{ patientUid: 'a', role: 'guardian' }, { patientUid: 'b', role: 'viewer' }, { patientUid: 'c', role: 'admin' }, { patientUid: 'd', role: 'viewer' }]

  it('only people whose settings are known to exist, under their name', () => {
    const people = listedPeople(links, { a: '할아버지', b: null, c: undefined, d: '엄마' })
    expect(people.map((p) => [p.patientUid, p.name])).toEqual([['a', '할아버지'], ['d', '엄마']])
    expect(people[0].membership).toBe(links[0])
  })

  it('nobody while nothing is known yet', () => {
    expect(listedPeople(links, {})).toEqual([])
  })
})

describe('a name that is already taken', () => {
  it('matches whatever the spacing or letter case', () => {
    expect(sameName('할아버지', ' 할 아버지 ')).toBe(true)
    expect(sameName('Grandpa', 'grandpa')).toBe(true)
    expect(sameName('할아버지', '외할아버지')).toBe(false)
  })

  it('says which existing name it clashes with', () => {
    expect(nameTaken('할아버지 ', ['엄마', '할아버지'])).toBe('할아버지')
    expect(nameTaken('외할아버지', ['엄마', '할아버지'])).toBeNull()
    expect(nameTaken('   ', ['엄마'])).toBeNull()
  })
})

describe('who the parent\'s photos go to', () => {
  it('names the first active family member who has a name', () => {
    expect(sentToName([
      { status: 'invited', caregiverName: '민수' },
      { status: 'active' },
      { status: 'active', caregiverName: ' 지은 ' },
    ])).toBe('지은')
  })

  it('says 가족 when nobody has a name yet', () => {
    expect(sentToName([])).toBe('가족')
    expect(sentToName([{ status: 'active', caregiverName: '' }])).toBe('가족')
  })
})

describe('consentButtonLabel', () => {
  it('names the family member who will see the photos', () => {
    expect(consentButtonLabel([{ status: 'active', caregiverName: '지은' }])).toBe('네, 지은에게 보여줄게요')
  })

  it('falls back when no name is known yet', () => {
    expect(consentButtonLabel([])).toBe('네, 보여줄게요')
    expect(consentButtonLabel([{ status: 'active' }])).toBe('네, 보여줄게요')
  })
})

describe('pickActivePatient', () => {
  const base = { selfUid: 'me', patientUids: ['mom', 'dad'], names: { mom: '엄마', dad: '아빠' } as Record<string, string | null> }

  it('the stored choice while reachable, else yourself', () => {
    expect(pickActivePatient({ ...base, stored: 'dad' })).toBe('dad')
    expect(pickActivePatient({ ...base, stored: 'me' })).toBe('me')
    expect(pickActivePatient({ ...base, stored: null })).toBe('me')
    expect(pickActivePatient({ ...base, stored: 'gone' })).toBe('me')
    expect(pickActivePatient({ ...base, names: { mom: '엄마', dad: null }, stored: 'dad' })).toBe('me')
  })

  it('simple edition: with nothing stored, the first parent whose name is known', () => {
    expect(pickActivePatient({ ...base, stored: null, preferParent: true })).toBe('mom')
    expect(pickActivePatient({ ...base, names: { mom: null, dad: '아빠' }, stored: null, preferParent: true })).toBe('dad')
    expect(pickActivePatient({ ...base, names: {}, stored: null, preferParent: true })).toBe('me')
    expect(pickActivePatient({ ...base, patientUids: [], names: {}, stored: null, preferParent: true })).toBe('me')
    // A stored choice (내 계정 included) still wins.
    expect(pickActivePatient({ ...base, stored: 'me', preferParent: true })).toBe('me')
  })
})

describe('how a parent is addressed (A10)', () => {
  it('kin words never take 님; other names do, once', () => {
    expect(honorific('엄마')).toBe('엄마')
    expect(honorific('엄마님')).toBe('엄마')
    expect(honorific(' 할아버지 ')).toBe('할아버지')
    expect(honorific('영희')).toBe('영희님')
    expect(honorific('영희님')).toBe('영희님')
    expect(honorific('')).toBe('')
  })

  it('with the particle that follows: 엄마가 새 사진을 올렸어요, 영희님이', () => {
    expect(honorificWith('엄마', '가')).toBe('엄마가')
    expect(honorificWith('영희', '가')).toBe('영희님이')
    expect(honorificWith('아버지', '는')).toBe('아버지는')
    expect(honorificWith('철수', '를')).toBe('철수님을')
    expect(honorificWith('할머니', '와')).toBe('할머니와')
    expect(`${honorific('엄마')}의 하루`).toBe('엄마의 하루')
    expect(`${honorific('엄마')}께 사진 보내기`).toBe('엄마께 사진 보내기')
  })

  it("re-addresses the worker's lines, and leaves other lines alone", () => {
    expect(addressed('엄마님이 새 사진을 올렸어요', '엄마')).toBe('엄마가 새 사진을 올렸어요')
    expect(addressed('엄마님의 하루', '엄마')).toBe('엄마의 하루')
    expect(addressed('엄마님 휴대폰(iPhone)이 연결되었어요.', '엄마')).toBe('엄마 휴대폰(iPhone)이 연결되었어요.')
    expect(addressed('영희님이 글을 남겼어요', '영희')).toBe('영희님이 글을 남겼어요')
    expect(addressed('오늘 아직 엄마님의 사진이 없어요', '엄마')).toBe('오늘 아직 엄마님의 사진이 없어요')
    expect(addressed('가족이 설정을 변경했어요.', '엄마')).toBe('가족이 설정을 변경했어요.')
  })
})

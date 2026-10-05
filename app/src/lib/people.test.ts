import { describe, it, expect } from 'vitest'
import { listedPeople, nameTaken, sameName } from './people'

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

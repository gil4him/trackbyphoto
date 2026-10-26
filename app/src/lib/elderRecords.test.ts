import { describe, it, expect } from 'vitest'
import { hasUnseen, reactionSentence, receivedLine } from './elderRecords'
import type { FamilyPhoto, Reaction } from '../types'

const r = (kind: Reaction['kind'], actorName: string, o: Partial<Reaction> = {}) => ({ id: `${kind}-${actorName}`, kind, actorName, actorUid: `u-${actorName}`, status: 'ready', ...o }) as Reaction

describe('the parent\'s 내 사진 sentences', () => {
  it('says who did what, as one sentence', () => {
    expect(reactionSentence([r('heart', '지민')], 'mom')).toBe('지민이 ❤️ 보냈어요')
    expect(reactionSentence([r('comment', '지민')], 'mom')).toBe('지민이 글을 남겼어요')
    expect(reactionSentence([r('heart', '지민'), r('comment', '지민')], 'mom')).toBe('지민이 ❤️ 하고 글을 남겼어요')
    expect(reactionSentence([r('heart', '지민'), r('heart', '민수')], 'mom')).toBe('지민 외 1명이 ❤️ 보냈어요')
    expect(reactionSentence([r('voice', '민수')], 'mom')).toBe('민수가 글을 남겼어요')
  })
  it('leaves out the parent\'s own replies and what is not ready', () => {
    expect(reactionSentence([r('comment', '엄마', { actorUid: 'mom' })], 'mom')).toBe('')
    expect(reactionSentence([r('heart', '지민', { status: 'pending' })], 'mom')).toBe('')
    expect(reactionSentence(undefined, 'mom')).toBe('')
  })
  it('새 소식 while anything from the family is unread', () => {
    expect(hasUnseen([r('heart', '지민')], 'mom')).toBe(true)
    expect(hasUnseen([r('heart', '지민', { readByElderAt: {} as never })], 'mom')).toBe(false)
  })
  it('a photo from the family says what the parent answered', () => {
    const p = { createdAtMs: new Date(2026, 9, 24, 20, 40).getTime(), reply: { kind: 'heart', atMs: 1 } } as FamilyPhoto
    expect(receivedLine(p)).toBe('오후 8:40 · ❤️ 고마워요 보냄')
    expect(receivedLine({ ...p, reply: undefined })).toBe('오후 8:40')
  })
})

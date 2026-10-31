// When the family side may be asked for a store review.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }))
vi.mock('@capacitor-community/in-app-review', () => ({ InAppReview: { requestReview: vi.fn() } }))
vi.mock('../firebase', () => ({ db: {} }))
vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { isParentReply, noteParentPhotoOpened, noteParentReply, reviewPromptOn, shouldAskForReview } from './reviewPrompt'
import type { Plans } from '../types'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000
const happy = { flagOn: true, photosOpened: 5, parentReplied: false, accountCreatedAt: NOW - 10 * DAY, lastAskAt: null, now: NOW }

describe('shouldAskForReview', () => {
  it('asks at the 5th photo opened, not the 4th', () => {
    expect(shouldAskForReview(happy)).toBe(true)
    expect(shouldAskForReview({ ...happy, photosOpened: 4 })).toBe(false)
  })

  it('asks at the first reply, whatever the photo count', () => {
    expect(shouldAskForReview({ ...happy, photosOpened: 0, parentReplied: true })).toBe(true)
  })

  it('never on an account under 3 days old, or of unknown age', () => {
    expect(shouldAskForReview({ ...happy, accountCreatedAt: NOW - 3 * DAY + 1000 })).toBe(false)
    expect(shouldAskForReview({ ...happy, accountCreatedAt: NOW - 3 * DAY })).toBe(true)
    expect(shouldAskForReview({ ...happy, accountCreatedAt: null })).toBe(false)
  })

  it('at most once in 90 days', () => {
    expect(shouldAskForReview({ ...happy, lastAskAt: NOW - 89 * DAY })).toBe(false)
    expect(shouldAskForReview({ ...happy, lastAskAt: NOW - 90 * DAY })).toBe(true)
  })

  it('not with the flag off', () => {
    expect(shouldAskForReview({ ...happy, flagOn: false })).toBe(false)
  })
})

describe('the flag defaults on', () => {
  const plans = (flags: Plans['flags']) => ({ flags }) as Plans
  it('only an explicit false turns it off', () => {
    expect(reviewPromptOn(plans({}))).toBe(true)
    expect(reviewPromptOn(plans({ reviewPrompt: true }))).toBe(true)
    expect(reviewPromptOn(plans({ reviewPrompt: false }))).toBe(false)
  })
  it('stays quiet until a plans copy has loaded', () => {
    expect(reviewPromptOn(null)).toBe(false)
  })
})

describe('what counts as a reply', () => {
  it('the parent answering, not a heart or another family member', () => {
    expect(isParentReply({ type: 'familyPhoto.reply', actorUid: 'p', patientUid: 'p' })).toBe(true)
    expect(isParentReply({ type: 'reaction.comment', actorUid: 'p', patientUid: 'p' })).toBe(true)
    expect(isParentReply({ type: 'reaction.voice', actorUid: 'p', patientUid: 'p' })).toBe(true)
    expect(isParentReply({ type: 'reaction.heart', actorUid: 'p', patientUid: 'p' })).toBe(false)
    expect(isParentReply({ type: 'reaction.comment', actorUid: 'sister', patientUid: 'p' })).toBe(false)
  })
})

describe('what is kept per account', () => {
  const stored = new Map<string, string>()
  beforeEach(() => {
    stored.clear()
    vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) })
  })
  const opened = (uid: string) => (JSON.parse(stored.get(`tbp.review.${uid}`) ?? '{"opened":[]}') as { opened: string[] }).opened

  it('the same photo counts once, and accounts stay apart', () => {
    noteParentPhotoOpened('a', 'm1')
    noteParentPhotoOpened('a', 'm1')
    noteParentPhotoOpened('a', 'm2')
    noteParentPhotoOpened('b', 'm1')
    expect(opened('a')).toEqual(['m1', 'm2'])
    expect(opened('b')).toEqual(['m1'])
  })

  it('remembers a reply', () => {
    noteParentReply('a')
    expect((JSON.parse(stored.get('tbp.review.a')!) as { replied: boolean }).replied).toBe(true)
  })
})

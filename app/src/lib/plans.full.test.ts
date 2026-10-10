// Rollout flags in the full edition.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../firebase', () => ({ db: {} }))
vi.mock('./edition', () => ({ isSimple: () => false, EDITION: 'full' }))

import { flagOn, SIMPLE_FLAGS_OFF } from './plans'
import type { Plans } from '../types'

const allOn = {
  flags: {
    reactions: true, voiceReplies: true, digest: true, emailDigest: true, pushFamily: true, usageCaps: true,
    retentionJob: true, messengerFree: true, trailMap: true, planSheet: true, familyPhotos: true, cloudMemo: true,
  },
} as unknown as Plans

describe('flagOn (full)', () => {
  it('core flags follow the plans doc', () => {
    expect(flagOn(allOn, 'reactions')).toBe(true)
    expect(flagOn(allOn, 'pushFamily')).toBe(true)
    expect(flagOn(null, 'reactions')).toBe(false)
  })

  it('full edition: the non-core features follow the doc', () => {
    for (const flag of SIMPLE_FLAGS_OFF) expect(flagOn(allOn, flag)).toBe(true)
  })
})

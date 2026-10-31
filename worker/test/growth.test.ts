// The two growth counters on admin_daily, and the review prompt's stamp on the account.

import { describe, it, expect, beforeEach } from 'vitest'
import { logGrowthEvent } from '../src/handlers/growth'
import { db, clearFirestore } from './setup'

const KID = { uid: 'cg1', email: 'kid@example.com', name: '민수' }
const today = () => new Date().toISOString().slice(0, 10)

describe('logGrowthEvent', () => {
  beforeEach(clearFirestore)

  it('counts a review ask on the day and stamps the account', async () => {
    await logGrowthEvent(KID, { event: 'review_prompt_shown' })
    await logGrowthEvent(KID, { event: 'review_prompt_shown' })
    expect((await db.doc(`admin_daily/${today()}`).get()).get('review_prompt_shown')).toBe(2)
    expect((await db.doc('users/cg1').get()).get('lastReviewAskAt')).toBeTruthy()
  })

  it('counts a share tap and leaves the account alone', async () => {
    await logGrowthEvent(KID, { event: 'share_tapped' })
    expect((await db.doc(`admin_daily/${today()}`).get()).get('share_tapped')).toBe(1)
    expect((await db.doc('users/cg1').get()).exists).toBe(false)
  })

  it('refuses any other event', async () => {
    await expect(logGrowthEvent(KID, { event: 'geminiUSD' })).rejects.toThrow('unknown event')
    await expect(logGrowthEvent(KID, {})).rejects.toThrow('unknown event')
  })
})

// The store's own review prompt (SKStoreReviewController, Play In-App Review),
// asked for directly at a happy moment on the family side: the 5th photo of a
// parent's they open, or the parent's first reply. Only on accounts at least 3
// days old, at most once in 90 days (users/{uid}.lastReviewAskAt, stamped by the
// worker's logGrowthEvent). Never on a parent's linked phone. The store decides
// whether it really shows; review_prompt_shown counts the asks.

import { Capacitor } from '@capacitor/core'
import { InAppReview } from '@capacitor-community/in-app-review'
import { doc, getDoc, type Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import type { AppNotification, Plans } from '../types'
import { isSimple } from './edition'
import { callWorker } from './worker'

const DAY_MS = 24 * 60 * 60 * 1000
export const REVIEW_PHOTOS = 5
export const REVIEW_MIN_ACCOUNT_DAYS = 3
export const REVIEW_EVERY_DAYS = 90

export function shouldAskForReview(s: {
  flagOn: boolean
  photosOpened: number
  parentReplied: boolean
  /** ms; null when unknown, which never asks. */
  accountCreatedAt: number | null
  lastAskAt: number | null
  now: number
}): boolean {
  if (!s.flagOn || s.accountCreatedAt === null) return false
  if (s.photosOpened < REVIEW_PHOTOS && !s.parentReplied) return false
  if (s.now - s.accountCreatedAt < REVIEW_MIN_ACCOUNT_DAYS * DAY_MS) return false
  return s.lastAskAt === null || s.now - s.lastAskAt >= REVIEW_EVERY_DAYS * DAY_MS
}

/** Default on: only an explicit false in admin_config/plans turns it off. No
 *  plans copy yet means nothing is known, so it stays quiet. */
export const reviewPromptOn = (plans: Plans | null): boolean => !!plans && plans.flags?.reviewPrompt !== false

/** The parent answered: a ready-made reply to a sent photo, or a word or voice
 *  from the parent's own phone. A heart isn't a reply. */
export function isParentReply(n: Pick<AppNotification, 'type' | 'actorUid' | 'patientUid'>): boolean {
  if (n.type === 'familyPhoto.reply') return true
  return (n.type === 'reaction.comment' || n.type === 'reaction.voice') && n.actorUid === n.patientUid
}

interface LocalState { opened: string[]; replied: boolean; askedAt: number | null }
const key = (uid: string) => `tbp.review.${uid}`

function readState(uid: string): LocalState {
  try {
    return { opened: [], replied: false, askedAt: null, ...(JSON.parse(localStorage.getItem(key(uid)) ?? '{}') as Partial<LocalState>) }
  } catch {
    return { opened: [], replied: false, askedAt: null }
  }
}

function writeState(uid: string, state: LocalState): void {
  try { localStorage.setItem(key(uid), JSON.stringify(state)) } catch { /* private mode */ }
}

/** One more of a parent's photos opened. The same photo twice counts once. */
export function noteParentPhotoOpened(uid: string, memoId: string): void {
  const state = readState(uid)
  if (state.opened.length >= REVIEW_PHOTOS || state.opened.includes(memoId)) return
  writeState(uid, { ...state, opened: [...state.opened, memoId] })
}

export function noteParentReply(uid: string): void {
  const state = readState(uid)
  if (!state.replied) writeState(uid, { ...state, replied: true })
}

let asking = false

export async function askForReviewIfDue(user: { uid: string; metadata: { creationTime?: string } }, plans: Plans | null): Promise<void> {
  if (asking || !isSimple() || !Capacitor.isNativePlatform()) return
  const state = readState(user.uid)
  const created = user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : NaN
  const due = (lastAskAt: number | null) => shouldAskForReview({
    flagOn: reviewPromptOn(plans),
    photosOpened: state.opened.length,
    parentReplied: state.replied,
    accountCreatedAt: Number.isNaN(created) ? null : created,
    lastAskAt,
    now: Date.now(),
  })
  if (!due(state.askedAt)) return
  asking = true
  try {
    const stamp = (await getDoc(doc(db, 'users', user.uid))).get('lastReviewAskAt') as Timestamp | undefined
    if (!due(Math.max(state.askedAt ?? 0, stamp?.toMillis() ?? 0) || null)) return
    writeState(user.uid, { ...state, askedAt: Date.now() })
    await callWorker('logGrowthEvent', { event: 'review_prompt_shown' }).catch((err) => console.warn('[review] not logged', err))
    await InAppReview.requestReview()
  } catch (err) {
    console.warn('[review] not asked', err)
  } finally {
    asking = false
  }
}

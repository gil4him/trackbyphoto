/** The parent's day as it happens — a photo, a heart or a word, the evening
 *  count, a quiet day, the summary. Everything else a notice can be about
 *  (phones linked, family changed, settings) is bookkeeping, which the
 *  simple edition's 알림 tab folds into 연결 기록 › (docs/DAYLIE_V3_UI_FIX.md A4). */
const FAMILY_EVENTS = ['photo.', 'reaction.', 'familyPhoto.', 'daily.', 'checkin.', 'digest.']
export const isFamilyEvent = (type: string) => FAMILY_EVENTS.some((p) => type.startsWith(p))

/** Shown on their own in the simple edition's 알림 rather than folded into
 *  연결 기록: the parent's day, and the free-trial notices about a parent's
 *  plan (plan.trialStarted / trialEnding / trialEnded), which open its plan sheet. */
export const isAlertRow = (type: string) => isFamilyEvent(type) || type.startsWith('plan.')

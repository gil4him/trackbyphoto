// The few settings a screen needs before the server has answered, or with no
// connection at all: whose name to greet, the text size, how they may reply.
// Kept on this phone only, and only as a stand-in until the real settings
// arrive; nothing is ever written back to the server from here.

import type { UserSettings } from '../types'

export type RememberedSettings = Pick<UserSettings, 'patientName' | 'bigText' | 'textReplies'>

const key = (uid: string) => `tbp.settings.${uid}`

export function rememberSettings(uid: string, s: Partial<UserSettings>): void {
  try {
    const kept: Partial<RememberedSettings> = { patientName: s.patientName, bigText: s.bigText, textReplies: s.textReplies }
    localStorage.setItem(key(uid), JSON.stringify(kept))
  } catch { /* private mode: nothing is remembered */ }
}

export function recallSettings(uid: string): Partial<RememberedSettings> | null {
  try {
    const raw = localStorage.getItem(key(uid))
    if (!raw) return null
    const s = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<RememberedSettings> = {}
    if (typeof s.patientName === 'string' && s.patientName) out.patientName = s.patientName
    if (typeof s.bigText === 'boolean') out.bigText = s.bigText
    if (s.textReplies === 'quick' || s.textReplies === 'full' || s.textReplies === 'off') out.textReplies = s.textReplies
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

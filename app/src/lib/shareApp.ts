// 가족·친구에게 알리기 (family Settings, and the Today card after the 3rd
// photo): the phone's share sheet with the owner's message. Korean only until
// an English message is approved.

import { Share } from '@capacitor/share'
import { copyPairMessage } from './share'
import { callWorker } from './worker'

export const SHARE_APP_TEXT = [
  '요즘 엄마 안부 이걸로 해.',
  '엄마는 카메라만 누르면 되고, 난 엄마가 오늘 어디 갔는지 사진으로 봐.',
  '무료야 → https://www.daylieai.com',
].join('\n')

/** 'copied' when this device has no share sheet. */
export async function shareApp(): Promise<'shared' | 'copied'> {
  callWorker('logGrowthEvent', { event: 'share_tapped' }).catch((err) => console.warn('[share-app] not logged', err))
  if ((await Share.canShare()).value) {
    try {
      await Share.share({ text: SHARE_APP_TEXT, dialogTitle: '가족·친구에게 알리기' })
    } catch {
      // Sheet closed without picking an app.
    }
    return 'shared'
  }
  await copyPairMessage(SHARE_APP_TEXT)
  return 'copied'
}

/** Who the Today card names: the parent with the most photos today, or null
 *  on a day with none (the card would otherwise read 0장). */
export function shareCardSubject(parentsToday: { name: string }[]): { name: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const { name } of parentsToday) counts.set(name, (counts.get(name) ?? 0) + 1)
  let best: { name: string; count: number } | null = null
  for (const [name, count] of counts) if (!best || count > best.count) best = { name, count }
  return best
}

const cardKey = (uid: string) => `tbp.shareCard.${uid}`

export function shareCardDone(uid: string): boolean {
  try { return localStorage.getItem(cardKey(uid)) !== null } catch { return false }
}

export function markShareCardDone(uid: string): void {
  try { localStorage.setItem(cardKey(uid), '1') } catch { /* private mode */ }
}

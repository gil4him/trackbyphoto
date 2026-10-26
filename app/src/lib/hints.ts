// One-time hints, remembered on this phone.

/** "여기서 부모님께 보낼 수 있어요" by ⋯ on one's own photo (A14.3). */
export const SEND_HINT_KEY = 'tbp.hint.sendFromMenu'

export function hintSeen(key: string, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try { return storage?.getItem(key) === '1' } catch { return true }
}

export function markHintSeen(key: string, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(key, '1') } catch { /* storage blocked */ }
}

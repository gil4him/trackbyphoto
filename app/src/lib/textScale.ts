// The parent's text size on 내 사진 and a memo (TextSizeFab), remembered on
// the phone. Three steps; the scale multiplies those pages' font sizes.

export interface TextLevel { key: 'normal' | 'big' | 'huge'; scale: number; label: string }

export const TEXT_LEVELS: TextLevel[] = [
  { key: 'normal', scale: 1, label: '보통' },
  { key: 'big', scale: 1.25, label: '크게' },
  { key: 'huge', scale: 1.5, label: '아주 크게' },
]

const KEY = 'tbp.elderTextScale'

export function nextTextLevel(level: TextLevel): TextLevel {
  const i = TEXT_LEVELS.findIndex((l) => l.key === level.key)
  return TEXT_LEVELS[(i + 1) % TEXT_LEVELS.length]
}

export function loadTextLevel(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): TextLevel {
  try {
    const key = storage?.getItem(KEY)
    return TEXT_LEVELS.find((l) => l.key === key) ?? TEXT_LEVELS[0]
  } catch {
    return TEXT_LEVELS[0]
  }
}

export function saveTextLevel(level: TextLevel, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, level.key)
  } catch {
    // Private mode: the size just isn't remembered.
  }
}

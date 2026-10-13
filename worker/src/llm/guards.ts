// Guards on a v2 memo, in code, so the writer's freedom stays inside the
// facts: the hook it names must be one it was given, every number and
// place in the title must come from the facts or the hooks, and the title
// must not be a near copy of a recent one. Pure; tested on its own.

export interface GuardFacts {
  /** Everything the writer was allowed to draw on: subjects, setting, sign
   *  text, hints, the hooks' text. */
  texts: string[]
}

export type GuardVerdict = { ok: true } | { ok: false; reason: 'hook' | 'number' | 'place' | 'relation' | 'similar'; detail: string }

/** Who the people are is never in the facts unless the family wrote it; the writer may not guess. */
const RELATIONS = ['가족', '식구', '딸', '아들', '손주', '손자', '손녀', '며느리', '사위', '아내', '남편', '부부', '친구', '동료', '엄마', '아빠', '어머니', '아버지', '저희', '우리']

/** Word endings that mark a place in Korean. */
const PLACE_SUFFIX = /(특별시|광역시|시|군|구|동|읍|면|리|역|공원|시장|마트|다리|산|강|항|해수욕장|사찰|절|궁|성당|교회|대학교|병원|호수|섬)$/
/** One-syllable endings (시/구/동/리/역/산/강/항/절/궁/섬) only mark a place on a
 *  word of three or more characters: 잠시, 도시, 동시, 유리 are not places. */
const SHORT_SUFFIX = /[시구동리역산강항절궁섬]$/
/** Particles a place word may carry in a title. */
const PARTICLES = /(에서는|에서도|에서|에는|에도|에|으로|로|의|은|는|이|가|을|를|과|와|도|만)$/
const DIGITS = /\d+/g
export const SIMILARITY_MAX = 0.6

const normalize = (s: string) => s.replace(/[\s,.··"“”'‘’()\[\]!?~]/g, '')

/** Character bigrams of a string with its spaces and punctuation removed. */
function bigrams(s: string): Map<string, number> {
  const n = normalize(s)
  const out = new Map<string, number>()
  for (let i = 0; i + 1 < n.length; i++) {
    const g = n.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** Dice similarity over character bigrams, 0..1. Strings under two characters never match. */
export function bigramSimilarity(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  let total = 0
  let shared = 0
  for (const v of A.values()) total += v
  for (const v of B.values()) total += v
  if (total === 0) return 0
  for (const [g, v] of A) shared += Math.min(v, B.get(g) ?? 0)
  return (2 * shared) / total
}

/** Tokens of a title that look like place names, particles stripped. */
export function placeTokens(memo: string): string[] {
  const out: string[] = []
  for (const raw of memo.split(/[\s,·]+/)) {
    const word = raw.replace(/["“”'‘’()!?.~]/g, '')
    if (word.length < 2) continue
    // "서초동에서" → "서초동"; "역에" → "역" (too short, skipped).
    const bare = word.replace(PARTICLES, '')
    const candidate = PLACE_SUFFIX.test(bare) ? bare : PLACE_SUFFIX.test(word) ? word : ''
    const min = SHORT_SUFFIX.test(candidate) && !/(공원|시장|마트|다리|호수|병원|교회|성당|대학교|사찰|해수욕장|특별시|광역시)$/.test(candidate) ? 3 : 2
    if (candidate.length >= min && !out.includes(candidate)) out.push(candidate)
  }
  return out
}

/**
 * Checks one written memo. `hookId` is what the writer claimed to use;
 * `hookIds` what it was offered; `facts.texts` what it may quote.
 */
export function checkMemo(memo: string, hookId: string | null, facts: GuardFacts, hookIds: string[], recentTitles: string[], scene = ''): GuardVerdict {
  if (hookId && !hookIds.includes(hookId)) return { ok: false, reason: 'hook', detail: hookId }
  const allowed = normalize(facts.texts.join(' '))
  for (const word of RELATIONS) {
    if ((memo.includes(word) || scene.includes(word)) && !allowed.includes(word)) return { ok: false, reason: 'relation', detail: word }
  }
  for (const n of memo.match(DIGITS) ?? []) {
    if (!allowed.includes(n)) return { ok: false, reason: 'number', detail: n }
  }
  for (const place of placeTokens(memo)) {
    if (!allowed.includes(place)) return { ok: false, reason: 'place', detail: place }
  }
  for (const t of recentTitles) {
    const sim = bigramSimilarity(memo, t)
    if (sim > SIMILARITY_MAX) return { ok: false, reason: 'similar', detail: `${t} (${sim.toFixed(2)})` }
  }
  return { ok: true }
}

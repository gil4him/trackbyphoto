/**
 * 재미있는 한 줄 (owner decision, 2026-10-30): one playful line under a photo's
 * memo, in its own field (`memos.funLine`). The memo itself (title, scene, the
 * memory diary prompt) is never read back into or changed by this step, and a
 * failure here only means a photo without the line.
 *
 * The fact comes first and is counted here from the account's own photos, so
 * the model cannot get a number wrong; the model only words it. Most photos
 * have no fact worth a line and get none. Korean only for now: English wording
 * has not been approved. Behind `memoFunLine`, or admin_config/funLine
 * ({ allow: [uid] }) to try it on one family first.
 */

import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { flagOn } from '../plans.js'
import { distanceKm, type LatLng } from '../travel.js'
import { geminiConfigured } from '../llm/gemini.js'
import { addressed } from './adminCheckIn.js'

export interface FunMemo {
  at: Date
  activity: string
  memo: string
  scene: string
  place: string
  lat: number | null
  lng: number | null
  funLine?: string
}

/** Never joked about, whatever the count says. */
const SENSITIVE = /병원|약국|장례|응급|수술|요양|치과|한의원|진료|입원|빈소|납골/
const STREAKS = new Set([3, 5, 7, 10, 14, 21, 30, 50, 100])
const COMPARED = new Set(['식사', '쇼핑'])
const FIRST_OF_MONTH = new Set(['쇼핑', '카페'])
const VAGUE = /^(식당|집|실내|차|차 안|가족|일행|점심|저녁|아침|식사|점심 식사|저녁 식사|.*의 식당|사무실|거실)$/
const HISTORY = 300
/** A line a day; a comparison, the best kind, may be a second one. */
const DAILY = 1
const DAILY_COMPARED = 2
const HOME_RADIUS_KM = 0.3
export const MAX_LINE = 40

/** What a meal or shop photo was about: the food, or the named place. '' when vague. */
export function subjectOf(m: Pick<FunMemo, 'memo' | 'scene'>): string {
  const food = m.memo.match(/([가-힣A-Za-z]+)(?:을|를) 드(?:셨|시)/)?.[1]
  if (food && !VAGUE.test(food)) return food
  const at = m.memo.match(/^(.+?)(?: 매장에|에서| 앞에|에 )/)?.[1]?.trim()
  if (at && !VAGUE.test(at) && !/함께|일행/.test(at)) return at
  const said = m.scene.match(/([가-힣A-Za-z]+)(?:을|를) 드(?:셨|시)/)?.[1]
  return said && !VAGUE.test(said) ? said : ''
}

const localIso = (at: Date, offsetMin: number) => new Date(at.getTime() + offsetMin * 60_000).toISOString()

/**
 * The one fact worth a line on this photo, or null. `history` is the account's
 * earlier photos, oldest first. `home` is the saved home only: without one, a
 * place count could call the parent's own home a 단골, so there are none.
 */
export function chooseFact(args: { history: FunMemo[]; current: FunMemo; offsetMin: number; name: string; home: LatLng | null }): string | null {
  const { history, current, offsetMin, name, home } = args
  if (SENSITIVE.test(`${current.activity} ${current.memo} ${current.scene}`)) return null

  const iso = localIso(current.at, offsetMin)
  const day = iso.slice(0, 10)
  const time = iso.slice(11, 16)
  const dayOf = (m: FunMemo) => localIso(m.at, offsetMin).slice(0, 10)
  const timeOf = (m: FunMemo) => localIso(m.at, offsetMin).slice(11, 16)
  const today = history.filter((m) => dayOf(m) === day)
  const linesToday = today.filter((m) => m.funLine).length
  const subject = subjectOf(current)

  if (COMPARED.has(current.activity) && subject && linesToday < DAILY_COMPARED) {
    const last = [...history].reverse().find((m) => m.activity === current.activity && !SENSITIVE.test(`${m.memo} ${m.scene}`) && subjectOf(m))
    if (last && subjectOf(last) !== subject) return `지난번 ${current.activity} 기록은 ${subjectOf(last)}, 이번은 ${subject}`
  }
  if (linesToday >= DAILY) return null

  if (history.length === 0) return `Daylie에 남긴 ${name ? `${name}의 ` : ''}첫 사진이에요`
  if (today.length === 0) {
    const days = new Set(history.map(dayOf))
    let streak = 1
    for (let d = new Date(`${day}T00:00:00Z`); days.has(new Date(d.getTime() - 864e5).toISOString().slice(0, 10)); d = new Date(d.getTime() - 864e5)) streak++
    if (STREAKS.has(streak)) return `${streak}일 연속으로 사진을 남겼어요`
  }
  if (FIRST_OF_MONTH.has(current.activity) && !history.some((m) => m.activity === current.activity && dayOf(m).slice(0, 7) === day.slice(0, 7))) {
    return `이번 달 첫 ${current.activity} 기록이에요`
  }
  if (history.length >= 5) {
    if (time < '07:00' && history.every((m) => timeOf(m) > time)) return `지금까지 남긴 사진 중 하루 중 가장 이른 시각이에요 (${time}). 기록이 처음 시작된 것은 아니에요`
    if (time >= '22:00' && history.every((m) => timeOf(m) < time)) return `지금까지 남긴 사진 중 하루 중 가장 늦은 시각이에요 (${time})`
  }
  if (history.length >= 14) {
    const perDay = new Map<string, number>()
    for (const m of history) if (dayOf(m) !== day) perDay.set(dayOf(m), (perDay.get(dayOf(m)) ?? 0) + 1)
    const best = Math.max(0, ...perDay.values())
    if (best >= 3 && today.length + 1 === best + 1) return `이번 달 가장 사진이 많은 날이 됐어요 (오늘 ${today.length + 1}장)`
  }
  if (subject && home && current.place && current.lat != null && current.lng != null
    && distanceKm({ lat: current.lat, lng: current.lng }, home) > HOME_RADIUS_KM) {
    const same = history.filter((m) => m.place === current.place)
    if (same.length >= 2 && dayOf(same[same.length - 1]) !== day) return `${subject} 기록이 ${same.length + 1}번째예요`
  }
  return null
}

const FEELINGS = /맛있|즐거|행복|기쁘|부지런|열정|달인|출석왕|역사적|든든/

/** The joke of a line: the words of its last sentence, without their particle. */
function jokeWords(line: string): string[] {
  const last = line.split(/[.!?]\s*/).filter(Boolean).pop() ?? ''
  return last.split(/\s+/).map((w) => w.replace(/[이가을를은는의에로도]$/, '')).filter((w) => w.length >= 2)
}

/** Whether a line may be shown: short, no made-up feeling, no joke told lately. */
export function lineOk(line: string, fact: string, recent: string[]): boolean {
  if (!line || line.length > MAX_LINE || FEELINGS.test(line)) return false
  const used = new Set(recent.flatMap(jokeWords))
  return !jokeWords(line).some((w) => used.has(w) && !fact.includes(w))
}

// The owner's approved style (2026-10-30). Changing it needs the owner's approval.
const EXAMPLES = [
  '열흘 연속 사진을 남기셨어요. 이 정도면 개근상이에요',
  '도서관 방문 벌써 세 번째예요. 이쯤 되면 단골이에요',
  '이번 달 가장 사진 많은 날이에요. 벌써 여섯 장째!',
  '지금까지 중 가장 이른 사진이에요. 새벽 5시 13분!',
  '칙필레 다음은 칼국수. 입맛의 국제 교류가 활발해요',
  '이번 달 첫 쇼핑 기록이에요. 첫 장바구니는 빵으로!',
  '빵집 다음 쇼핑은 자동차 부품. 취향의 폭이 넓으세요',
  '이번 달 첫 카페 기록이에요. 디저트로 시작하셨네요',
  '헬로 스시에 이어 쌀국수. 아시아 미식 순항 중이에요',
  '첫 사진이 거울 셀카. 시작부터 자신감 넘쳐요',
  '이 휴대폰으로 남긴 다섯 번째 사진이에요. 충전 기다리며 기록도 충전 중',
]

export function funLinePrompt(memo: string, fact: string, recent: string[]): string {
  return `가족 사진 기록 앱에서 사진 메모 아래에 붙는 재미있는 한 줄을 써 주세요.
사진 메모: "${memo}"
사실: ${fact}
규칙:
- 위 사실만 사용하고 다른 사실이나 숫자를 지어내지 마세요.
- 해요체, ${MAX_LINE}자 이내, 가벼운 농담 하나. 문장은 최대 두 개.
- 건강, 나이, 외모, 자책, 다른 가족과의 비교는 쓰지 마세요.
- 그 사람의 감정, 취향, 열정, 앞으로 일어날 일을 짐작하지 마세요. 평범하다고 놀리지 마세요.
- 영어 주소를 그대로 쓰지 말고 메모에 나온 한국어 이름을 쓰세요.
- 예시를 그대로 베끼지 말고, 사진 메모의 내용으로 새로 쓰세요. '맛있', '즐거', '행복', '부지런', '열정'처럼 느낌을 말하는 단어는 쓰지 마세요.
${recent.length ? `- 최근에 쓴 줄과 같은 농담을 쓰지 마세요: ${recent.join(' / ')}\n` : ''}예시: ${EXAMPLES.join(' / ')}
JSON으로만 답하세요: {"line":"..."}`
}

const MODEL = 'gemini-3.1-flash-lite'
const TIMEOUT_MS = 15_000
const TRIES = 3

/** One answer from the model; '' when there is none. Never throws. */
async function askGemini(prompt: string): Promise<string> {
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'
  try {
    const res = await fetch(`${base}/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) { logger.warn('[funLine] gemini failed', { status: res.status }); return '' }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }
    const u = json.usageMetadata ?? {}
    const usd = (u.promptTokenCount ?? 0) * 0.25e-6 + ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) * 1.5e-6
    logger.info('[llm-cost] usage', { model: MODEL, what: 'funLine', usd: Number(usd.toFixed(6)) })
    const raw = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const line = (JSON.parse(raw) as { line?: unknown }).line
    return typeof line === 'string' ? line.trim() : ''
  } catch (err) {
    logger.warn('[funLine] gemini failed', { err: String(err) })
    return ''
  }
}

/** Worded and checked, or '' after a few tries: no line is better than a bad one. */
export async function wordFunLine(memo: string, fact: string, recent: string[], ask: (prompt: string) => Promise<string> = askGemini): Promise<string> {
  const prompt = funLinePrompt(memo, fact, recent)
  for (let i = 0; i < TRIES; i++) {
    const line = await ask(prompt)
    if (lineOk(line, fact, recent)) return line
  }
  return ''
}

let allowCache: { value: Set<string>; expiresAt: number } | null = null
export function resetFunLineCache() { allowCache = null }

async function allowed(patientUid: string): Promise<boolean> {
  if (await flagOn('memoFunLine')) return true
  const now = Date.now()
  if (!allowCache || allowCache.expiresAt <= now) {
    const allow = (await getFirestore().doc('admin_config/funLine').get()).data()?.allow
    allowCache = { value: new Set(Array.isArray(allow) ? allow.filter((u): u is string => typeof u === 'string') : []), expiresAt: now + 60_000 }
  }
  return allowCache.value.has(patientUid)
}

export interface FunLineArgs {
  memoId: string
  patientUid: string
  current: FunMemo
  offsetMin: number
  lang: string | undefined
}

/** Add the line to a memo just finished, when it has earned one. */
export async function addFunLine(args: FunLineArgs, ask?: (prompt: string) => Promise<string>): Promise<void> {
  const { memoId, patientUid, current, offsetMin, lang } = args
  if (lang === 'en' || !current.memo) return
  if (!ask && !geminiConfigured()) return
  if (!(await allowed(patientUid))) return

  const db = getFirestore()
  const user = (await db.doc(`users/${patientUid}`).get()).data()
  const snap = await db.collection('memos')
    .where('patientUid', '==', patientUid)
    .where('takenAt', '<', current.at)
    .orderBy('takenAt', 'desc')
    .limit(HISTORY)
    .get()
  const history: FunMemo[] = snap.docs.flatMap((d) => {
    const m = d.data()
    const at = m.takenAt?.toDate?.() as Date | undefined
    if (d.id === memoId || !at || m.status === 'error') return []
    return [{ at, activity: m.activity ?? '', memo: m.memo ?? '', scene: m.scene ?? '', place: m.place ?? '', lat: typeof m.lat === 'number' ? m.lat : null, lng: typeof m.lng === 'number' ? m.lng : null, funLine: m.funLine }]
  }).reverse()

  const saved = user?.home as Partial<LatLng> | undefined
  const home = typeof saved?.lat === 'number' && typeof saved?.lng === 'number' ? { lat: saved.lat, lng: saved.lng } : null
  const name = user?.accountType === 'managed' ? addressed((user.patientName as string) || '부모님') : ''
  const fact = chooseFact({ history, current, offsetMin, name, home })
  if (!fact) return

  const recent = history.flatMap((m) => m.funLine ? [m.funLine] : []).slice(-10)
  const line = await wordFunLine(current.memo, fact, recent, ask)
  if (!line) { logger.info('[funLine] no line passed', { memoId }); return }
  await db.doc(`memos/${memoId}`).update({ funLine: line, funLineAt: FieldValue.serverTimestamp() })
  logger.info('[funLine] added', { memoId, fact })
}

// Kakao 알림톡 through a Korean dealer (Solapi's v4 API).
// Env: KAKAO_ALIMTALK_API_KEY, KAKAO_ALIMTALK_API_SECRET, KAKAO_ALIMTALK_PFID
// (the business channel), KAKAO_ALIMTALK_SENDER (registered caller number),
// KAKAO_ALIMTALK_TEMPLATE_DIGEST (the approved template's id).
// The approved template must use the variables #{name}, #{date}, #{link}.
// Not yet exercised against a real dealer account.

import { createHmac, randomBytes } from 'node:crypto'
import { logger } from '../log.js'
import { TEMPLATE_VARS, type Env, type Fetch, type MessengerProvider } from './index.js'

export function alimtalk(env: Env, fetchFn: Fetch): MessengerProvider | null {
  const apiKey = env.KAKAO_ALIMTALK_API_KEY
  const secret = env.KAKAO_ALIMTALK_API_SECRET
  const pfId = env.KAKAO_ALIMTALK_PFID
  const sender = env.KAKAO_ALIMTALK_SENDER
  const templates = { digest: env.KAKAO_ALIMTALK_TEMPLATE_DIGEST }
  if (!apiKey || !secret || !pfId || !sender || !templates.digest) return null
  const cost = { amount: Number(env.ALIMTALK_UNIT_COST_KRW ?? 8), currency: 'KRW' as const }
  return {
    name: 'alimtalk',
    async send(to, template, vars) {
      try {
        const date = new Date().toISOString()
        const salt = randomBytes(16).toString('hex')
        const signature = createHmac('sha256', secret).update(date + salt).digest('hex')
        const res = await fetchFn('https://api.solapi.com/messages/v4/send', {
          method: 'POST',
          headers: {
            Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              to: `0${to.slice(3)}`, // +8210… → 010…
              from: sender,
              kakaoOptions: {
                pfId,
                templateId: templates[template],
                variables: Object.fromEntries(TEMPLATE_VARS[template].map((key) => [`#{${key}}`, vars[key] ?? ''])),
                // Never fall back to a paid text message on our behalf.
                disableSms: true,
              },
            },
          }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
        return { ok: true, provider: 'alimtalk', cost }
      } catch (err) {
        logger.warn('[messenger] alimtalk failed', { err: String(err) })
        return { ok: false, provider: 'alimtalk', error: String(err) }
      }
    },
  }
}

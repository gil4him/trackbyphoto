// SMS through Twilio. Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM.
// Not yet exercised against a real Twilio account.

import { logger } from '../log.js'
import { renderText, type Env, type Fetch, type MessengerProvider } from './index.js'

export function sms(env: Env, fetchFn: Fetch): MessengerProvider | null {
  const sid = env.TWILIO_ACCOUNT_SID
  const token = env.TWILIO_AUTH_TOKEN
  const from = env.TWILIO_FROM
  if (!sid || !token || !from) return null
  const cost = { amount: Number(env.SMS_UNIT_COST_USD ?? 0.05), currency: 'USD' as const }
  return {
    name: 'sms',
    async send(to, template, vars) {
      try {
        const res = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: to, From: from, Body: renderText(template, vars) }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
        return { ok: true, provider: 'sms', cost }
      } catch (err) {
        logger.warn('[messenger] sms failed', { err: String(err) })
        return { ok: false, provider: 'sms', error: String(err) }
      }
    },
  }
}

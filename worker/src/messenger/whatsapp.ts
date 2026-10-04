// WhatsApp through Meta's Cloud API (a pre-approved "utility" template).
// Env: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE_DIGEST (the
// template's name), optional WHATSAPP_TEMPLATE_LANG (default ko).
// The template body takes its variables in TEMPLATE_VARS order.
// Not yet exercised against a real WhatsApp Business account.

import { logger } from '../log.js'
import { TEMPLATE_VARS, type Env, type Fetch, type MessengerProvider } from './index.js'

export function whatsapp(env: Env, fetchFn: Fetch): MessengerProvider | null {
  const token = env.WHATSAPP_TOKEN
  const phoneId = env.WHATSAPP_PHONE_ID
  const templates = { digest: env.WHATSAPP_TEMPLATE_DIGEST }
  if (!token || !phoneId || !templates.digest) return null
  const cost = { amount: Number(env.WHATSAPP_UNIT_COST_USD ?? 0.02), currency: 'USD' as const }
  return {
    name: 'whatsapp',
    async send(to, template, vars) {
      try {
        const res = await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to.replace(/^\+/, ''),
            type: 'template',
            template: {
              name: templates[template],
              language: { code: env.WHATSAPP_TEMPLATE_LANG || 'ko' },
              components: [{ type: 'body', parameters: TEMPLATE_VARS[template].map((key) => ({ type: 'text', text: vars[key] ?? '' })) }],
            },
          }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
        return { ok: true, provider: 'whatsapp', cost }
      } catch (err) {
        logger.warn('[messenger] whatsapp failed', { err: String(err) })
        return { ok: false, provider: 'whatsapp', error: String(err) }
      }
    },
  }
}

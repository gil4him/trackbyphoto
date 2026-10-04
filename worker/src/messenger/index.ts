/**
 * Messenger delivery of the digest: one line and a link to the digest page,
 * never the photo.
 *
 * Which provider carries a message depends on the number and on which
 * accounts are configured in ~/.trackbyphoto/worker.env:
 *   Korean numbers (+82)  → Kakao 알림톡, else SMS
 *   everywhere else       → WhatsApp, else SMS
 * With no keys at all, everything goes to the no-op provider, which only
 * logs. These are the only paid calls the worker makes.
 */

import { alimtalk } from './alimtalk.js'
import { noop } from './noop.js'
import { sms } from './sms.js'
import { whatsapp } from './whatsapp.js'

export type MessageTemplate = 'digest'

/** What a template can say. Providers that need positional variables use this order. */
export const TEMPLATE_VARS: Record<MessageTemplate, string[]> = {
  digest: ['name', 'date', 'link'],
}

export interface SendResult {
  ok: boolean
  provider: string
  /** A rough per-message cost, for the admin dashboard only. */
  cost?: { amount: number; currency: 'KRW' | 'USD' }
  error?: string
}

export interface MessengerProvider {
  name: string
  /** `to` is E.164 (+821012345678). Never throws. */
  send(to: string, template: MessageTemplate, vars: Record<string, string>): Promise<SendResult>
}

export type Fetch = typeof fetch
export type Env = Record<string, string | undefined>

/** The plain-text form of a template (SMS, and the 알림톡 template's wording). */
export function renderText(template: MessageTemplate, vars: Record<string, string>): string {
  switch (template) {
    case 'digest':
      return `[오늘하루] ${vars.name}님의 ${vars.date} 요약이 도착했어요.\n${vars.link}`
  }
}

/** "010-1234-5678" or "+82 10 1234 5678" → "+821012345678"; null when it isn't a phone number. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  if (trimmed.startsWith('+')) return /^\d{8,15}$/.test(digits) ? `+${digits}` : null
  // A bare number is read as Korean: 010-1234-5678.
  if (/^01\d{8,9}$/.test(digits)) return `+82${digits.slice(1)}`
  return null
}

/** "+821012345678" → "010-****-5678": enough to recognise, not enough to call. */
export function maskPhone(e164: string): string {
  const local = e164.startsWith('+82') ? `0${e164.slice(3)}` : e164
  return `${local.slice(0, 3)}-****-${local.slice(-4)}`
}

export function providerFor(to: string, env: Env = process.env, fetchFn: Fetch = fetch): MessengerProvider {
  const candidates = to.startsWith('+82')
    ? [alimtalk(env, fetchFn), sms(env, fetchFn)]
    : [whatsapp(env, fetchFn), sms(env, fetchFn)]
  return candidates.find((p) => p !== null) ?? noop
}

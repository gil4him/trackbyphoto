// Which model writes a photo's memo.
//
// Gemini when it is configured (GEMINI_API_KEY) AND the person is let through:
// the cloudMemo rollout flag is on for everyone, or their uid is on the
// allowlist in admin_config/cloudLlm ({ allow: [uid] }). That doc, unlike
// admin_config/plans, is not readable by any app. Everyone else, and every
// cloud failure, goes to the local model on the Mac mini. This is the only
// place a photo can leave the Mac mini for a model.

import { getFirestore } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { flagOn } from '../plans.js'
import { CloudLlmError, generateMemoGemini, geminiConfigured } from './gemini.js'
import { withModelLock } from './lock.js'
import { generateMemo, type LlmResult } from './ollama.js'
import type { PromptHints } from './prompt.js'

/** Gemini takes inline images up to 20 MB of request; base64 adds a third. */
const MAX_INLINE_BASE64 = 19_000_000

export type MemoArgs = PromptHints & {
  imageBase64: string
  patientUid: string
  mimeType?: string
  temperature?: number
}

let allowCache: { value: Set<string>; expiresAt: number } | null = null

async function allowlist(): Promise<Set<string>> {
  const now = Date.now()
  if (allowCache && allowCache.expiresAt > now) return allowCache.value
  let value = new Set<string>()
  try {
    const allow = (await getFirestore().doc('admin_config/cloudLlm').get()).data()?.allow
    if (Array.isArray(allow)) value = new Set(allow.filter((u): u is string => typeof u === 'string'))
  } catch (err) {
    logger.warn('[llm] cloud allowlist read failed; treating it as empty', { err: String(err) })
  }
  allowCache = { value, expiresAt: now + 60_000 }
  return value
}

export function resetCloudCache() {
  allowCache = null
}

export async function cloudMemoAllowed(patientUid: string): Promise<boolean> {
  if (!geminiConfigured()) return false
  return (await flagOn('cloudMemo')) || (await allowlist()).has(patientUid)
}

export interface RouteDeps {
  cloud: (args: MemoArgs & { mimeType: string }) => Promise<LlmResult>
  local: (args: MemoArgs) => Promise<LlmResult>
  allowed: (patientUid: string) => Promise<boolean>
}

const defaultRouteDeps: RouteDeps = {
  cloud: generateMemoGemini,
  // Shares the Mac mini with speech-to-text: one model at a time. The cloud
  // call needs no such lock.
  local: (args) => withModelLock(() => generateMemo(args)),
  allowed: cloudMemoAllowed,
}

/** Write the memo with Gemini when allowed, else (or on any cloud failure)
 *  with the local model, whose errors keep their usual meaning. */
export async function generateMemoRouted(args: MemoArgs, deps: RouteDeps = defaultRouteDeps): Promise<LlmResult> {
  if (args.imageBase64.length <= MAX_INLINE_BASE64 && await deps.allowed(args.patientUid)) {
    try {
      return await deps.cloud({ ...args, mimeType: args.mimeType || 'image/jpeg' })
    } catch (err) {
      if (!(err instanceof CloudLlmError)) throw err
      logger.warn('[llm] cloud failed; writing with the local model', { err: err.message })
    }
  }
  return { source: 'local-llm', ...(await deps.local(args)) }
}

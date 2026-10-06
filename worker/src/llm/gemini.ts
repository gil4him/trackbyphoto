// Cloud vision model: Gemini 3.1 Flash-Lite through the Gemini API.
//
// Used only for the people llm/route.ts lets through (the cloudMemo flag, or
// the allowlist in admin_config/cloudLlm); everyone else stays on the Mac
// mini. Any failure here is one error class: the router then writes the memo
// with the local model instead, so a cloud outage never holds a memo up.

import { logger } from '../log.js'
import { buildPrompt, parseModelResponse, type PromptHints } from './prompt.js'
import type { LlmResult } from './ollama.js'

export const CLOUD_MODEL = 'gemini-3.1-flash-lite'
const TIMEOUT_MS = 20_000
// List prices, USD per token (paid tier).
const IN_USD = 0.25e-6
const OUT_USD = 1.5e-6
/** Same as the local model: one answer per photo, the same every run. */
const TEMPERATURE = 0

/** The cloud call failed (HTTP, timeout, blocked, unparseable). */
export class CloudLlmError extends Error {}

export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
  error?: { message?: string }
}

export async function generateMemoGemini(args: PromptHints & {
  imageBase64: string
  mimeType: string
  temperature?: number
}): Promise<LlmResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new CloudLlmError('GEMINI_API_KEY is not set')
  // GEMINI_BASE_URL points tests at a fake server.
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'
  const started = Date.now()
  let res: Response
  let json: GeminiResponse
  try {
    res = await fetch(`${base}/v1beta/models/${CLOUD_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: args.mimeType, data: args.imageBase64 } }, { text: buildPrompt(args, 'cloud') }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: args.temperature ?? TEMPERATURE },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    json = (await res.json().catch(() => ({}))) as GeminiResponse
  } catch (err) {
    throw new CloudLlmError(`gemini request failed: ${String(err)}`)
  }
  if (!res.ok) throw new CloudLlmError(`gemini HTTP ${res.status}: ${json.error?.message?.slice(0, 200) ?? ''}`)

  const raw = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
  const u = json.usageMetadata ?? {}
  const promptTokens = u.promptTokenCount ?? 0
  // Thinking tokens are billed as output.
  const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)
  const totalUSD = promptTokens * IN_USD + outputTokens * OUT_USD
  logger.info('[llm-cost] usage', { model: CLOUD_MODEL, promptTokens, outputTokens, usd: Number(totalUSD.toFixed(6)), ms: Date.now() - started })

  const parsed = parseModelResponse(raw, { relaxed: true })
  if (!parsed) throw new CloudLlmError(`unparseable gemini output (${json.candidates?.[0]?.finishReason ?? 'no candidate'}): ${raw.slice(0, 200)}`)
  return { ...parsed, model: CLOUD_MODEL, source: 'cloud-llm', cost: { promptTokens, outputTokens, totalUSD } }
}

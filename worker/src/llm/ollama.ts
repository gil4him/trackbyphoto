// Local vision model via Ollama's native API (http://localhost:11434).
//
// Same call shape as Teleios' llama-service.ts (/api/generate, stream:false,
// JSON-schema `format`), plus `images` for the photo. Ollama is never exposed
// beyond localhost — the worker is the only thing that talks to it.

import { getFirestore } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { buildPrompt, parseModelResponse, VALID_CATEGORIES, type PromptHints } from './prompt.js'

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e4b'
// Generation on a 16 GB Mac mini takes ~20-30 s per photo; a cold model load
// adds ~10 s. 180 s leaves headroom when Teleios is also using Ollama.
const TIMEOUT_MS = 180_000
// Unload the model 2 minutes after the last photo so the RAM goes back to
// Teleios' image generation (mflux) quickly. Memo volume is low, so the
// occasional reload is cheap.
const KEEP_ALIVE = '2m'
// 0 = the model's single most likely answer, the same every run. At 0.2 the
// same photo flipped between right and wrong categories from run to run,
// which also made prompt changes impossible to judge.
const TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE ?? 0)
/** For "AI로 다시 쓰기": some variety, or a re-write would repeat itself. */
export const REWRITE_TEMPERATURE = 0.5

/** Local models the dashboard picker may select. All free. */
export const LOCAL_MODELS: Record<string, { label: string }> = {
  'gemma4:e4b': { label: 'Gemma 4 E4B (Mac mini)' },
}

export interface LlmResult {
  activity: string
  memo: string
  scene: string
  model: string
  /** Token counts for the dashboard. USD is always 0 for local models but the
   *  field stays so the counter rollup keeps its shape. */
  cost: { promptTokens: number; outputTokens: number; totalUSD: number }
}

/** Ollama is up but generation failed (bad JSON, model error). Counts toward
 *  the per-photo retry budget. */
export class LlmGenerationError extends Error {}
/** Ollama itself is unreachable (not running, Mac mini busy rebooting).
 *  Never counts toward the retry budget — the job just waits. */
export class LlmUnavailableError extends Error {}

// JSON schema handed to Ollama's `format` so the model can only emit the
// three fields we parse.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    activity: { type: 'string', enum: [...VALID_CATEGORIES] },
    memo: { type: 'string' },
    scene: { type: 'string' },
  },
  required: ['activity', 'memo', 'scene'],
}

// Resolve the active model. Priority:
//   1. admin_config/global.model (set live from the /superadmin picker), if
//      it names a local model (older docs may still say 'gemini-2.5-flash')
//   2. OLLAMA_MODEL env var / default
// Cached for 60s so we don't hit Firestore on every photo.
let modelCache: { value: string; expiresAt: number } | null = null
export async function resolveModel(): Promise<string> {
  const now = Date.now()
  if (modelCache && modelCache.expiresAt > now) return modelCache.value
  let chosen = DEFAULT_MODEL
  try {
    const snap = await getFirestore().collection('admin_config').doc('global').get()
    const override = (snap.exists ? (snap.data()?.model as string | undefined) : undefined)?.trim()
    if (override && LOCAL_MODELS[override]) chosen = override
  } catch (err) {
    logger.warn('[llm] admin_config read failed; using default model', { err: String(err) })
  }
  modelCache = { value: chosen, expiresAt: now + 60_000 }
  return chosen
}

export async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5_000) })
    return res.ok
  } catch {
    return false
  }
}

interface OllamaGenerateResponse {
  response?: string
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

/** Run the memo prompt on a photo. Throws LlmUnavailableError or
 *  LlmGenerationError; never returns a partial result. */
export async function generateMemo(args: PromptHints & {
  imageBase64: string
  /** Skip the admin_config lookup (used by scripts/probe.ts). */
  model?: string
  /** Sampling temperature; defaults to TEMPERATURE. */
  temperature?: number
}): Promise<LlmResult> {
  const model = args.model || await resolveModel()
  const started = Date.now()
  let res: Response
  try {
    res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: buildPrompt({ timeHint: args.timeHint, placeHint: args.placeHint, homeHint: args.homeHint, textHint: args.textHint }),
        images: [args.imageBase64],
        format: RESPONSE_SCHEMA,
        stream: false,
        // Thinking burns time and output budget on a one-line caption.
        think: false,
        keep_alive: KEEP_ALIVE,
        options: { temperature: args.temperature ?? TEMPERATURE, num_predict: 600 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    // Connection refused / DNS / timeout before any response.
    if (!(await ollamaAvailable())) throw new LlmUnavailableError(`ollama unreachable: ${String(err)}`)
    throw new LlmGenerationError(`ollama request failed: ${String(err)}`)
  }

  const body = (await res.json().catch(() => ({}))) as OllamaGenerateResponse
  if (!res.ok) throw new LlmGenerationError(`ollama HTTP ${res.status}: ${body.error || ''}`)

  const raw = (body.response || '').trim()
  const parsed = parseModelResponse(raw)
  if (!parsed) throw new LlmGenerationError(`unparseable model output: ${raw.slice(0, 200)}`)

  const promptTokens = body.prompt_eval_count ?? 0
  const outputTokens = body.eval_count ?? 0
  logger.info('[llm-cost] usage', { model, promptTokens, outputTokens, ms: Date.now() - started })
  return { ...parsed, model, cost: { promptTokens, outputTokens, totalUSD: 0 } }
}

// Memo v2 orchestration: see → context → write → guards, with v1 as the
// fallback. The two model calls live here; the prompts in promptV2.ts.

import { LlmGenerationError, ollamaGenerate, resolveModel } from './ollama.js'
import { buildSeePrompt, buildWritePrompt, parseSeeResponse, parseWriteResponse, SEE_SCHEMA, WRITE_SCHEMA, type Seen, type WriteInput, type Written } from './promptV2.js'
import type { PromptHints } from './prompt.js'

export interface SeeArgs extends PromptHints {
  imageBase64: string
  /** Skip the admin_config lookup (scripts, tests). */
  model?: string
}

export interface SeeResult {
  seen: Seen
  model: string
  cost: { promptTokens: number; outputTokens: number; totalUSD: number }
}

/** The photo as facts, at temperature 0 (the same every run). Throws
 *  LlmUnavailableError or LlmGenerationError, like generateMemo. */
export async function generateSee(args: SeeArgs): Promise<SeeResult> {
  const model = args.model || await resolveModel()
  const { raw, promptTokens, outputTokens } = await ollamaGenerate(model, {
    prompt: buildSeePrompt(args),
    images: [args.imageBase64],
    format: SEE_SCHEMA,
    options: { temperature: 0, num_predict: 300 },
  })
  const seen = parseSeeResponse(raw)
  if (!seen) throw new LlmGenerationError(`unparseable see() output: ${raw.slice(0, 200)}`)
  return { seen, model, cost: { promptTokens, outputTokens, totalUSD: 0 } }
}

/** The writer's temperature: some variety, so two days never read the same. */
export const WRITE_TEMPERATURE = 0.8
/** One more try, looser, when the guards reject the first answer. */
export const WRITE_RETRY_TEMPERATURE = 0.95

export interface WriteArgs extends WriteInput {
  model?: string
  temperature?: number
}

export interface WriteResult extends Written {
  model: string
  cost: { promptTokens: number; outputTokens: number; totalUSD: number }
}

/** The memo from the facts, text only (the photo is not sent again). */
export async function generateWrite(args: WriteArgs): Promise<WriteResult> {
  const model = args.model || await resolveModel()
  const { raw, promptTokens, outputTokens } = await ollamaGenerate(model, {
    prompt: buildWritePrompt(args),
    format: WRITE_SCHEMA,
    options: { temperature: args.temperature ?? WRITE_TEMPERATURE, num_predict: 400 },
  })
  const written = parseWriteResponse(raw)
  if (!written) throw new LlmGenerationError(`unparseable write() output: ${raw.slice(0, 200)}`)
  return { ...written, model, cost: { promptTokens, outputTokens, totalUSD: 0 } }
}

// Memo v2 orchestration: see → context → write → guards, with v1 as the
// fallback. Step 1: the see() call only.

import { LlmGenerationError, ollamaGenerate, resolveModel } from './ollama.js'
import { buildSeePrompt, parseSeeResponse, SEE_SCHEMA, type Seen } from './promptV2.js'
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

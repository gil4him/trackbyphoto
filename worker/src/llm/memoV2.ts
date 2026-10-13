// Memo v2 orchestration: see → context → write → guards, with v1 as the
// fallback. The two model calls live here; the prompts in promptV2.ts.

import { logger } from '../log.js'
import { flagOn } from '../plans.js'
import { buildHooks, fetchWeather, labelsOf, loadContextData, photoOffsetMin, recentTitles, type ContextData } from './context.js'
import { checkMemo } from './guards.js'
import { withModelLock } from './lock.js'
import { generateMemo, LlmGenerationError, LlmUnavailableError, ollamaGenerate, resolveModel, type LlmResult } from './ollama.js'
import type { MemoArgs } from './route.js'
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

// ── The whole of v2, with v1 as the fallback ───────────────────────────────

/** What v2 adds to a memo result; absent when v1 wrote it. */
export interface V2Extras {
  memoVersion: 2
  hookId: string | null
  seen: Seen
}
export type V2Result = LlmResult & Partial<V2Extras>

/** Injected so tests run without the model or Firestore. */
export interface V2Deps {
  see: (args: SeeArgs) => Promise<SeeResult>
  write: (args: WriteArgs) => Promise<WriteResult>
  loadContext: (patientUid: string, takenAt: Date) => Promise<ContextData>
  offsetMin: (patientUid: string, lat: number | null, lng: number | null, tzOffsetMin?: number | null) => Promise<number>
  weather: (lat: number | null, lng: number | null) => Promise<string | null>
  v1: (args: MemoArgs) => Promise<LlmResult>
}

export const defaultV2Deps: V2Deps = {
  see: generateSee,
  write: generateWrite,
  loadContext: loadContextData,
  offsetMin: photoOffsetMin,
  weather: fetchWeather,
  v1: generateMemo,
}

/**
 * see → hooks → write → guards (one retry, looser) — the two model calls
 * under one lock. Anything the model gets wrong falls back to v1 inside the
 * same lock, so the photo is never re-queued for it; only an unreachable
 * Ollama is passed up, as always.
 */
export async function generateMemoV2(args: MemoArgs, deps: V2Deps = defaultV2Deps): Promise<V2Result> {
  const takenAt = args.takenAt ?? new Date()
  const lat = args.coords?.lat ?? null
  const lng = args.coords?.lng ?? null
  const [data, tzOffsetMin, weather] = await Promise.all([
    deps.loadContext(args.patientUid, takenAt),
    deps.offsetMin(args.patientUid, lat, lng, args.tzOffsetMin),
    deps.weather(lat, lng),
  ])
  return withModelLock(async () => {
    try {
      const { seen, model, cost } = await deps.see(args)
      const hooks = buildHooks(data, { takenAtMs: takenAt.getTime(), lat, lng, tzOffsetMin, labels: labelsOf(args.tags) }, seen.activity, weather)
      const recent = recentTitles(data.past)
      const hints = { timeHint: args.timeHint, placeHint: args.placeHint, homeHint: args.homeHint }
      const facts = { texts: [...seen.subjects, seen.setting, ...seen.signText, args.placeHint ?? '', args.timeHint ?? '', ...hooks.map((h) => h.text)] }
      const input: WriteInput = { seen, hooks, recentTitles: recent, style: data.style, hints }
      const ids = hooks.map((h) => h.id)
      let written = await deps.write({ ...input, model, temperature: WRITE_TEMPERATURE })
      let verdict = checkMemo(written.memo, written.hookId, facts, ids, recent)
      if (!verdict.ok) {
        logger.info('[memo-v2] guard rejected; one more try', { reason: verdict.reason, detail: verdict.detail, memo: written.memo })
        written = await deps.write({ ...input, model, temperature: WRITE_RETRY_TEMPERATURE })
        verdict = checkMemo(written.memo, written.hookId, facts, ids, recent)
      }
      if (!verdict.ok) throw new LlmGenerationError(`guard: ${verdict.reason} (${verdict.detail}) in "${written.memo}"`)
      return {
        activity: seen.activity,
        memo: written.memo,
        scene: written.scene,
        model,
        source: 'local-llm-v2',
        cost: { promptTokens: cost.promptTokens + written.cost.promptTokens, outputTokens: cost.outputTokens + written.cost.outputTokens, totalUSD: 0 },
        memoVersion: 2,
        hookId: written.hookId,
        seen,
      }
    } catch (err) {
      if (err instanceof LlmUnavailableError || !(err instanceof LlmGenerationError)) throw err
      logger.warn('[memo-v2] falling back to v1', { err: err.message })
      return { source: 'local-llm', ...(await deps.v1(args)) }
    }
  })
}

/** The local path for route.ts: v2 while its flag is on, else v1 under the lock. */
export async function generateMemoLocal(args: MemoArgs): Promise<V2Result> {
  if (await flagOn('memoV2')) return generateMemoV2(args)
  return withModelLock(() => generateMemo(args))
}

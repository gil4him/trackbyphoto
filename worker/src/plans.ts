/**
 * Plan entitlements: the single source of truth is admin_config/plans.
 * Clients and the worker read that doc and never hard-code a tier table.
 * The table itself is not in this (public) repository: scripts/plans.ts
 * seeds the doc from a private file, ~/.trackbyphoto/plans.seed.json.
 *
 * Photos are unlimited on every tier. Tiers differ by how the family
 * receives the day, how many family members join, how long memories are
 * kept, and hearing the parent's voice.
 */

import { getFirestore } from 'firebase-admin/firestore'
import { logger } from './log.js'

export const PLAN_TIERS = ['free', 'basic', 'plus', 'family'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

export interface PlanEntitlements {
  familyMembers: number
  retentionDays: number | null
  messenger: boolean
  weekly: boolean
  checkin: boolean
  recap: boolean
  voiceReplies: boolean
  voiceAlbum: boolean
  aiPhotosPerDay: number | null
  seniors: number
}

/** Rollout switches. Everything ships off and is turned on per feature. */
export const PLAN_FLAGS = ['reactions', 'voiceReplies', 'digest', 'pushFamily', 'usageCaps', 'retentionJob', 'messengerFree'] as const
export type PlanFlag = (typeof PLAN_FLAGS)[number]

export interface PlansDoc extends Record<PlanTier, PlanEntitlements> {
  fairUse: { photosPerDay: number | null }
  flags: Record<PlanFlag, boolean>
}

let cache: { value: PlansDoc | null; expiresAt: number } | null = null

/** The plans doc, re-read at most once a minute. Null when it doesn't exist
 *  or can't be read; callers then treat every flag as off. */
export async function getPlans(): Promise<PlansDoc | null> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value
  let value: PlansDoc | null = null
  try {
    value = ((await getFirestore().doc('admin_config/plans').get()).data() as PlansDoc | undefined) ?? null
  } catch (err) {
    logger.warn('[plans] read failed; treating every flag as off', { err: String(err) })
  }
  cache = { value, expiresAt: now + 60_000 }
  return value
}

export async function flagOn(flag: PlanFlag): Promise<boolean> {
  return (await getPlans())?.flags?.[flag] === true
}

/** The tier a patient was put on, or null when nobody has set one. */
export function explicitTier(user: FirebaseFirestore.DocumentData | undefined): PlanTier | null {
  const tier = user?.plan?.tier
  return PLAN_TIERS.includes(tier) ? (tier as PlanTier) : null
}

/** A patient without a plan is on Free. */
export function tierOf(user: FirebaseFirestore.DocumentData | undefined): PlanTier {
  return explicitTier(user) ?? 'free'
}

/** Tests change the doc between cases. */
export function resetPlansCache() { cache = null }

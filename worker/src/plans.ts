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
export const PLAN_FLAGS = ['reactions', 'voiceReplies', 'digest', 'pushFamily', 'retentionJob', 'messengerFree'] as const
export type PlanFlag = (typeof PLAN_FLAGS)[number]

export interface PlansDoc extends Record<PlanTier, PlanEntitlements> {
  fairUse: { photosPerDay: number | null }
  flags: Record<PlanFlag, boolean>
}

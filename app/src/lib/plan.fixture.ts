// A made-up plans table for tests. The real one is not in this repository.
import type { PlanEntitlements, Plans, PlanTier } from '../types'

const tier = (o: Partial<PlanEntitlements> = {}): PlanEntitlements => ({
  familyMembers: 1, retentionDays: 9, messenger: false, weekly: false, checkin: false, recap: false,
  voiceReplies: false, voiceAlbum: false, aiPhotosPerDay: 37, seniors: 1, ...o,
})
export const PLANS: Plans & Record<PlanTier, PlanEntitlements> = {
  free: tier(),
  basic: tier({ familyMembers: 2, retentionDays: 45, messenger: true, voiceReplies: true, aiPhotosPerDay: null }),
  plus: tier({ familyMembers: 2, retentionDays: 730, messenger: true, voiceReplies: true, weekly: true, checkin: true, aiPhotosPerDay: null }),
  family: tier({ familyMembers: 6, retentionDays: null, messenger: true, voiceReplies: true, weekly: true, checkin: true, recap: true, voiceAlbum: true, seniors: 2, aiPhotosPerDay: null }),
  fairUse: { photosPerDay: 411 },
  flags: { digest: true, emailDigest: true, voiceReplies: true, retentionJob: true, planSheet: true },
}

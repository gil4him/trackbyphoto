/**
 * TrackByPhoto Mac mini worker — replaces every Cloud Function.
 *
 * Runs under launchd (KeepAlive) on the Mac mini with a service-account key,
 * and talks to Firebase over outbound connections only; nothing listens on
 * a port. Firestore listeners:
 *   memos    status == 'pending'  → photo memo pipeline (local Ollama model)
 *   requests status == 'pending'  → former HTTPS callables (invites, roles…)
 *   users    any change           → settings-change audit + elder notices
 *
 * Any listener error exits the process; launchd restarts it and the initial
 * snapshots catch up on whatever queued in between.
 *
 * Env:
 *   GOOGLE_APPLICATION_CREDENTIALS  service-account key (prod)
 *   FIREBASE_STORAGE_BUCKET         default trackbyphoto-app.firebasestorage.app
 *   OLLAMA_BASE_URL / OLLAMA_MODEL  default http://localhost:11434 / gemma4:e4b
 *   KAKAO_REST_KEY                  optional, Korean reverse geocoding
 *   GEMINI_API_KEY                  optional, Gemini memos for those let through (llm/route.ts)
 *   PAYMENT_PROVIDER                'revenuecat' for store subscriptions; default the stand-in
 *   REVENUECAT_SECRET_KEY           its REST key; without it no paid plan is confirmed
 *   WORKER_STATE_DIR                default ~/.trackbyphoto/state
 *   APP_URL                         default https://trackbyphoto.web.app (links in pair/push/digest)
 *   EDITION                         'simple' for the simple-core worker; default full (config.ts)
 *   APP_STORE_URL / PLAY_STORE_URL  store pages the app-update notice opens (config.ts)
 *   FIRESTORE_EMULATOR_HOST etc.    honored by firebase-admin for local runs
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { cert, initializeApp } from 'firebase-admin/app'
import { logger } from './log.js'
import { ollamaAvailable, resolveModel } from './llm/ollama.js'
import { MemoScheduler, watchPendingMemos } from './handlers/memo.js'
import { startDailyNotices } from './handlers/dailyNotice.js'
import { edition } from './config.js'
import { watchGeocodeRequests } from './handlers/place.js'
import { purgeStaleRequests, requeueInterruptedRequests, watchRequests } from './handlers/requests.js'
import { SettingsCache, watchUserSettings } from './handlers/audit.js'
import { ReactionScheduler, watchReactions } from './handlers/reactions.js'
import { startRetention } from './handlers/retention.js'
import { startDigests } from './handlers/digest.js'
import { startMorningPush } from './handlers/morning.js'
import { startHousekeeping } from './handlers/housekeeping.js'
import { startSubscriptionPoll } from './handlers/subscriptions.js'
import { watchFamilyPhotos } from './handlers/familyPhotos.js'
import { startHeartbeat } from './heartbeat.js'
import { playConfigured, startStoreVersions } from './storeVersions.js'
import { sttAvailable } from './llm/stt.js'
import { geminiConfigured } from './llm/gemini.js'
import { weatherKitConfigured } from './weather.js'
import { deployedCommit } from './deployed.js'

const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'trackbyphoto-app.firebasestorage.app'
const STATE_DIR = process.env.WORKER_STATE_DIR || join(homedir(), '.trackbyphoto', 'state')

async function main() {
  // Load the key file as an explicit credential so custom tokens (phone
  // pairing) are signed locally; application-default credentials would sign
  // through the IAM signBlob API, which this service account isn't granted.
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS
  initializeApp({ storageBucket: STORAGE_BUCKET, ...(keyFile ? { credential: cert(keyFile) } : {}) })

  logger.info('[worker] starting', {
    bucket: STORAGE_BUCKET,
    emulator: process.env.FIRESTORE_EMULATOR_HOST || null,
    model: await resolveModel(),
    ollama: (await ollamaAvailable()) ? 'up' : 'DOWN (memos will wait)',
    stt: (await sttAvailable()) ? 'up' : 'DOWN (voice replies will wait)',
    cloud: geminiConfigured() ? 'configured (cloudMemo flag / admin_config/cloudLlm decide who)' : 'off',
    weather: weatherKitConfigured() ? 'WeatherKit' : 'off (no WEATHERKIT_* settings)',
    storeVersions: playConfigured() ? 'itunes+play' : 'itunes only',
    // scripts/install.sh records it; tells anyone reading the log what is running.
    deployedCommit: deployedCommit(),
  })

  await requeueInterruptedRequests()
  await purgeStaleRequests()

  const cache = new SettingsCache(join(STATE_DIR, 'users-cache.json'))
  const scheduler = new MemoScheduler()
  const reactions = new ReactionScheduler()
  const unsubs = [
    watchPendingMemos(scheduler),
    watchGeocodeRequests(),
    watchReactions(reactions),
    watchRequests(),
    watchUserSettings(cache),
    startHeartbeat(() => scheduler.waiting),
    // The store versions behind the family's app-update notice (system/app).
    startStoreVersions(),
    startRetention(),
    startDigests(),
    startHousekeeping(),
    // 운영실: the CEO's 08:00 summary push (behind the ceoMorningPush switch).
    startMorningPush(),
    watchFamilyPhotos(),
    // Store subscriptions only end on the store's say-so, so they are polled.
    ...(process.env.PAYMENT_PROVIDER === 'revenuecat' ? [startSubscriptionPoll()] : []),
    // Simple edition: one notice a day instead of one per photo.
    ...(edition() === 'simple' ? [startDailyNotices()] : []),
  ]
  const purgeTimer = setInterval(() => {
    purgeStaleRequests().catch((err) => logger.warn('[request] purge failed', { err: String(err) }))
  }, 3600 * 1000)

  const shutdown = (signal: string) => {
    logger.info('[worker] shutting down', { signal })
    clearInterval(purgeTimer)
    scheduler.stop()
    reactions.stop()
    unsubs.forEach((u) => u())
    cache.flush()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  logger.info('[worker] listening')
}

main().catch((err) => {
  logger.error('[worker] fatal startup error', { err: String(err), stack: (err as Error)?.stack })
  process.exit(1)
})

#!/usr/bin/env node
/**
 * The check on the worker from outside the Mac mini, run by
 * .github/workflows/watchdog.yml: when the machine or the worker is down,
 * nothing on it can say so. Reads the heartbeat (system/worker) the way any
 * signed-in client may, with a throwaway anonymous session it deletes, so it
 * needs no credentials beyond the public web key. It prints what it finds; the
 * workflow keeps one GitHub issue open while there's a problem, and GitHub
 * emails the repo's owner.
 *
 * Exit 0: checked (see the "problem" line). Exit 1: couldn't check.
 */
import { fileURLToPath } from 'node:url'

export const STALE_MS = 10 * 60_000

/** What's wrong, in a line, or null. Only the time and FCM's code: the repo is public. */
export function problemWith(beat, now) {
  if (!beat?.lastSeenMs) return 'The worker has never reported a heartbeat.'
  const minutes = Math.round((now - beat.lastSeenMs) / 60_000)
  if (now - beat.lastSeenMs > STALE_MS) return `The worker's last heartbeat was ${minutes} minutes ago. Photos wait and no alerts go out until it is back.`
  if (beat.failAt && (!beat.okAt || beat.okAt < beat.failAt)) return `The last push failed (${beat.failCode ?? 'unknown'}) and none has got through since.`
  return null
}

/** Firestore's REST shape to what problemWith reads. */
export function beatFrom(doc) {
  const f = doc?.fields ?? {}
  const push = f.push?.mapValue?.fields ?? {}
  const num = (v) => (v?.integerValue ? Number(v.integerValue) : v?.doubleValue ?? null)
  return {
    lastSeenMs: f.lastSeen?.timestampValue ? Date.parse(f.lastSeen.timestampValue) : null,
    okAt: num(push.okAt),
    failAt: num(push.failAt),
    failCode: push.failCode?.stringValue ?? null,
  }
}

async function json(url, init) {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${new URL(url).pathname}: HTTP ${res.status}`)
  return res.json()
}

async function main() {
  const { FIREBASE_API_KEY: key, FIREBASE_PROJECT_ID: project } = process.env
  if (!key || !project) throw new Error('FIREBASE_API_KEY and FIREBASE_PROJECT_ID are required')
  const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const auth = 'https://identitytoolkit.googleapis.com/v1/accounts'
  const { idToken } = await json(`${auth}:signUp?key=${key}`, post({ returnSecureToken: true }))
  try {
    const doc = await json(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/system/worker`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    const problem = problemWith(beatFrom(doc), Date.now())
    console.log(problem ? `problem=${problem}` : 'ok')
  } finally {
    await json(`${auth}:delete?key=${key}`, post({ idToken })).catch((err) => console.error('session not deleted', String(err)))
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(String(err)); process.exit(1) })
}

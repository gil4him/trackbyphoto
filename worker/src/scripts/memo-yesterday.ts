// Re-write yesterday's photo memos with the current prompts, side by side
// with what was written then, so a prompt change is judged on real photos:
//
//   npm run memo-yesterday                       every parent's photos from yesterday
//   npm run memo-yesterday -- --email a@b.com    only that account's parents (or their own photos)
//   npm run memo-yesterday -- --patient <uid>    one parent
//   npm run memo-yesterday -- --days-ago 0       today instead (1 = yesterday, the default)
//   npm run memo-yesterday -- --env ~/daylie-secrets/simple/worker.env   the simple edition
//
// Same path as production (llm/route.ts: Gemini for the people let through,
// else the Mac mini's model, v2 when its flag is on) and the same hints
// (handlers/memo.ts memoArgsFor). Reads Firestore and Storage, never writes a
// memo. Writes <out>/memo-yesterday.html (default ~/.trackbyphoto/memo-yesterday)
// and opens it. The photos stay on this Mac.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const expand = (p: string) => p.replace(/^~(?=\/|$)/, homedir())

// The worker's env file (GEMINI_API_KEY, KAKAO_REST_KEY, OLLAMA_MODEL, …), as run.sh loads it.
const envFile = expand(arg('env', join(homedir(), '.trackbyphoto', 'worker.env'))!)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').replace(/\$HOME|\$\{HOME\}/g, homedir())
  }
}

const { cert, initializeApp } = await import('firebase-admin/app')
const { getAuth } = await import('firebase-admin/auth')
const { getFirestore } = await import('firebase-admin/firestore')
const { getStorage } = await import('firebase-admin/storage')
const { memoArgsFor } = await import('../handlers/memo.js')
const { generateMemoRouted } = await import('../llm/route.js')
const { homeHintFor } = await import('../travel.js')
const { momentLines } = await import('../llm/moment.js')

const keyFile = expand(process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), '.trackbyphoto', 'sa-key.json'))
const projectId = (JSON.parse(readFileSync(keyFile, 'utf8')) as { project_id: string }).project_id
initializeApp({ credential: cert(keyFile), storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app` })
const db = getFirestore()
const out = expand(arg('out', join(homedir(), '.trackbyphoto', 'memo-yesterday'))!)
mkdirSync(out, { recursive: true })
const daysAgo = Number(arg('days-ago', '1'))
const limit = Number(arg('n', '40'))

// Whose photos: one parent, an account's parents (and its own photos), or everyone.
async function patientsOf(email: string): Promise<string[]> {
  let uid: string
  try {
    uid = (await getAuth().getUserByEmail(email)).uid
  } catch (err) {
    const users = await db.collection('users').where('email', '==', email).limit(1).get()
    if (users.empty) throw new Error(`no account for ${email} (${String(err).slice(0, 80)}); use --patient <uid>`)
    uid = users.docs[0].id
  }
  const ms = await db.collection('memberships').where('caregiverUid', '==', uid).where('status', '==', 'active').get()
  return [uid, ...ms.docs.map((d) => d.get('patientUid') as string)]
}
const only = arg('patient') ? [arg('patient')!] : arg('email') ? await patientsOf(arg('email')!) : null

/** The photographer's calendar day of an instant, YYYY-MM-DD. */
const dayOf = (ms: number, offsetMin: number) => new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10)
const now = Date.now()
const since = new Date(now - (daysAgo + 2) * 86_400_000)
const snap = await db.collection('memos').where('takenAt', '>=', since).orderBy('takenAt', 'asc').get()
const memos = snap.docs.filter((d) => {
  const m = d.data()
  if (m.status !== 'ready' || !m.photoPath || (only && !only.includes(m.patientUid))) return false
  const offset = typeof m.tzOffsetMin === 'number' ? m.tzOffsetMin : 540
  return dayOf(m.takenAt.toMillis(), offset) === dayOf(now - daysAgo * 86_400_000, offset)
}).slice(0, limit)

const label = daysAgo === 1 ? 'yesterday' : daysAgo === 0 ? 'today' : `${daysAgo} days ago`
console.log(`${projectId}: ${memos.length} photos from ${label}${only ? ` (${only.length} account(s))` : ''}\n`)
if (!memos.length) process.exit(0)

interface Row {
  id: string; who: string; photoUrl: string; when: string; place: string; moment: string[]
  before: { activity: string; memo: string; scene: string; source: string }
  after: { activity: string; memo: string; scene: string; source: string; guess: string; seconds: number } | { error: string }
}
const names = new Map<string, string>()
const rows: Row[] = []
for (const [i, d] of memos.entries()) {
  const m = d.data()
  const patientUid = m.patientUid as string
  if (!names.has(patientUid)) names.set(patientUid, ((await db.doc(`users/${patientUid}`).get()).get('patientName') as string) || patientUid.slice(0, 6))
  const place = (m.place as string) || ''
  const lat = typeof m.lat === 'number' ? m.lat : null
  const lng = typeof m.lng === 'number' ? m.lng : null
  const row: Row = {
    id: d.id, who: names.get(patientUid)!, photoUrl: (m.photoUrl as string) || '', when: '', place, moment: [],
    before: { activity: m.activity || '', memo: m.memo || '', scene: m.scene || '', source: m.memoSource || '' },
    after: { error: 'not run' },
  }
  rows.push(row)
  try {
    const imageBase64 = (await getStorage().bucket().file(m.photoPath as string).download())[0].toString('base64')
    const args = await memoArgsFor(d.id, m, { place, homeHint: await homeHintFor(patientUid, lat, lng), imageBase64, fresh: true })
    row.when = [args.dayHint, args.timeHint, args.weather ? `${args.weather.label} ${args.weather.tempC}°C` : ''].filter(Boolean).join(' ')
    row.moment = momentLines(args).filter((l) => l.startsWith('- ') || l.includes('해 뜨는 시각') || l.startsWith('  - '))
    const t = Date.now()
    const r = await generateMemoRouted(args) as { activity: string; memo: string; scene: string; source?: string; guess?: string }
    row.after = { activity: r.activity, memo: r.memo, scene: r.scene, source: r.source ?? '', guess: r.guess ?? '', seconds: (Date.now() - t) / 1000 }
  } catch (err) {
    row.after = { error: String(err).slice(0, 200) }
  }
  const a = row.after
  console.log(`[${i + 1}/${memos.length}] ${row.who} · ${row.when} · ${place || '(위치 없음)'}`)
  console.log(`   이전: ${row.before.memo}  — ${row.before.scene}`)
  console.log('error' in a ? `   새로: 실패 ${a.error}` : `   새로: ${a.memo}  — ${a.scene}\n   짐작: ${a.guess || '-'}  (${a.source}, ${a.seconds.toFixed(1)}s)`)
  console.log('')
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const card = (r: Row) => {
  const a = r.after
  return `<article>
  <a href="${esc(r.photoUrl)}" target="_blank"><img src="${esc(r.photoUrl)}" loading="lazy" alt=""></a>
  <div class="body">
    <div class="meta">${esc(r.who)} · ${esc(r.when)} · ${esc(r.place || '위치 없음')}</div>
    <div class="col before"><span class="tag">이전 · ${esc(r.before.source)}</span><h3>${esc(r.before.memo)}</h3><p>${esc(r.before.scene)}</p></div>
    <div class="col after"><span class="tag">새 프롬프트${'error' in a ? '' : ` · ${esc(a.source)}`}</span>${'error' in a
      ? `<h3 class="err">실패</h3><p>${esc(a.error)}</p>`
      : `<h3>${esc(a.memo)}</h3><p>${esc(a.scene)}</p><p class="guess">짐작: ${esc(a.guess || '-')}</p>`}</div>
    <details><summary>AI에게 준 때와 흐름</summary><pre>${esc(r.moment.join('\n'))}</pre></details>
  </div>
</article>`
}
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>메모 비교 · ${label}</title><style>
:root{--bg:#f5f5f7;--card:#fff;--ink:#1d1d1f;--sub:#6e6e73;--new:#0071e3;--line:#e5e5ea}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;padding:24px 16px}
h1{font-size:28px;margin:0 auto 4px;max-width:980px}.lead{color:var(--sub);max-width:980px;margin:0 auto 24px}
article{display:grid;grid-template-columns:260px 1fr;gap:20px;background:var(--card);border-radius:18px;padding:16px;max-width:980px;margin:0 auto 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:12px;background:var(--line)}
.meta{color:var(--sub);font-size:14px;margin-bottom:10px}.col{padding:10px 12px;border-radius:12px;margin-bottom:8px}
.before{background:#f2f2f4}.after{background:#eaf3ff}.tag{font-size:12px;color:var(--sub)}.after .tag{color:var(--new)}
h3{margin:2px 0 4px;font-size:18px}p{margin:0}.guess{margin-top:6px;font-size:13px;color:var(--sub)}.err{color:#c00}
details{font-size:13px;color:var(--sub)}pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,Menlo,monospace}
@media (max-width:640px){article{grid-template-columns:1fr}}
</style></head><body><h1>메모 비교 · ${label}</h1><p class="lead">${rows.length}장 · 위: 그때 쓴 메모, 아래 파란 칸: 새 프롬프트. DB에는 저장하지 않았어요.</p>
${rows.map(card).join('\n')}</body></html>`
const file = join(out, 'memo-yesterday.html')
writeFileSync(file, html)
writeFileSync(join(out, 'memo-yesterday.json'), JSON.stringify(rows, null, 1))
console.log(`wrote ${file}`)
if (process.platform === 'darwin' && !process.argv.includes('--no-open')) execFile('open', [file])
process.exit(0)

// Compare memo v1 (one call) with memo v2 (see → hooks → write → guards)
// on a parent's real photos, side by side, so the switch to v2 is judged
// on thirty pictures rather than one lucky run:
//
//   npm run memo-compare -- [--patient <uid>] [--n 30] [--out <dir>]
//   npm run memo-compare -- --results <picks.json>     (score an earlier run)
//   npm run memo-compare -- --page                     (rebuild the page from the saved JSON)
//
// Reads production Firestore and Storage (never writes a memo), runs the
// Mac mini's model, and writes <out>/memo-compare.{json,html}. The page
// has v1 / v2 / 무승부 buttons per row (kept in the browser) and a button
// that downloads the picks as JSON; feed that file back with --results.
// Default out: ~/.trackbyphoto/memo-compare. The photos stay private.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { buildHooks, labelsOf, loadContextData, photoOffsetMin, recentTitles, type Hook } from '../llm/context.js'
import { checkMemo, type GuardVerdict } from '../llm/guards.js'
import { generateSee, generateWrite, WRITE_RETRY_TEMPERATURE, WRITE_TEMPERATURE } from '../llm/memoV2.js'
import { generateMemo } from '../llm/ollama.js'
import { areaOf, readableText, type VisionTags } from '../llm/prompt.js'
import type { Seen } from '../llm/promptV2.js'
import { homeHintFor, localTimeHint } from '../travel.js'

interface Try { temperature: number; memo: string; scene: string; hookId: string | null; verdict: GuardVerdict }
interface Row {
  memoId: string
  photoUrl: string
  takenAt: string
  place: string
  activity: string
  current: { memo: string; scene: string; source: string }
  v1: { activity: string; memo: string; scene: string; seconds: number } | { error: string }
  v2: { seen: Seen; hooks: Hook[]; recentTitles: string[]; style: string; tries: Try[]; final: { memo: string; scene: string; hookId: string | null } | null; seconds: number } | { error: string }
}

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const out = arg('out', join(homedir(), '.trackbyphoto', 'memo-compare'))!
mkdirSync(out, { recursive: true })

if (arg('results')) {
  score(arg('results')!)
  process.exit(0)
}
if (process.argv.includes('--page')) {
  const saved = JSON.parse(readFileSync(join(out, 'memo-compare.json'), 'utf8')) as { rows: Row[] }
  writeFileSync(join(out, 'memo-compare.html'), page(saved.rows))
  console.log(`wrote ${join(out, 'memo-compare.html')} (${saved.rows.length} rows)`)
  factCheck(saved.rows)
  process.exit(0)
}

const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), '.trackbyphoto', 'sa-key.json')
const projectId = (JSON.parse(readFileSync(keyFile, 'utf8')) as { project_id: string }).project_id
initializeApp({ credential: cert(keyFile), storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app` })
const db = getFirestore()
const n = Number(arg('n', '30'))
const model = process.env.OLLAMA_MODEL || 'gemma4:e4b'

async function busiestPatient(): Promise<string> {
  const snap = await db.collection('memos').orderBy('takenAt', 'desc').limit(200).get()
  const counts = new Map<string, number>()
  for (const d of snap.docs) if (d.get('status') === 'ready' && d.get('photoPath')) counts.set(d.get('patientUid'), (counts.get(d.get('patientUid')) ?? 0) + 1)
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  if (!best) throw new Error('no ready memos with photos')
  return best
}

const patientUid = arg('patient') || await busiestPatient()
const snap = await db.collection('memos').where('patientUid', '==', patientUid).orderBy('takenAt', 'desc').limit(n * 3).get()
const memos = snap.docs.filter((d) => d.get('status') === 'ready' && d.get('photoPath') && !['local-stub', 'stored-only'].includes(d.get('memoSource'))).slice(0, n)
console.log(`${projectId}: patient ${patientUid.slice(0, 8)}…, ${memos.length} photos, model ${model}, out ${out}`)

const rows: Row[] = []
for (const [i, d] of memos.entries()) {
  const m = d.data()
  const takenAt = (m.takenAt as Timestamp).toDate()
  const lat = typeof m.lat === 'number' ? (m.lat as number) : null
  const lng = typeof m.lng === 'number' ? (m.lng as number) : null
  const tags = (m.tags as VisionTags | undefined) ?? null
  const row: Row = {
    memoId: d.id, photoUrl: (m.photoUrl as string) || '', takenAt: takenAt.toISOString(), place: (m.place as string) || '', activity: (m.activity as string) || '',
    current: { memo: (m.memo as string) || '', scene: (m.scene as string) || '', source: (m.memoSource as string) || '' },
    v1: { error: 'not run' }, v2: { error: 'not run' },
  }
  rows.push(row)
  process.stdout.write(`\n[${i + 1}/${memos.length}] ${d.id} ${row.place || '(no place)'}\n   now: ${row.current.memo}\n`)
  let imageBase64: string
  try {
    imageBase64 = (await getStorage().bucket().file(m.photoPath as string).download())[0].toString('base64')
  } catch (err) {
    row.v1 = row.v2 = { error: `photo: ${String(err).slice(0, 120)}` }
    continue
  }
  const hints = {
    timeHint: await localTimeHint(patientUid, takenAt, lat, lng, m.tzOffsetMin as number | undefined),
    placeHint: areaOf((m.place as string) || '') || undefined,
    homeHint: await homeHintFor(patientUid, lat, lng),
    textHint: readableText(tags?.text),
  }

  let t = Date.now()
  try {
    const r = await generateMemo({ ...hints, imageBase64, model })
    row.v1 = { activity: r.activity, memo: r.memo, scene: r.scene, seconds: (Date.now() - t) / 1000 }
    process.stdout.write(`   v1:  ${r.activity} | ${r.memo}\n`)
  } catch (err) {
    row.v1 = { error: String(err).slice(0, 160) }
    process.stdout.write(`   v1:  FAILED ${row.v1.error}\n`)
  }

  t = Date.now()
  try {
    const [{ seen }, data, tzOffsetMin] = await Promise.all([
      generateSee({ ...hints, imageBase64, model }),
      loadContextData(patientUid, takenAt),
      photoOffsetMin(patientUid, lat, lng, m.tzOffsetMin as number | undefined),
    ])
    const hooks = buildHooks(data, { takenAtMs: takenAt.getTime(), lat, lng, tzOffsetMin, labels: labelsOf(tags) }, seen.activity, null)
    const recent = recentTitles(data.past)
    const facts = { texts: [...seen.subjects, seen.setting, ...seen.signText, `${seen.peopleCount}명`, hints.placeHint ?? '', hints.timeHint ?? '', ...hooks.map((h) => h.text)] }
    const input = { seen, hooks, recentTitles: recent, style: data.style, hints: { timeHint: hints.timeHint, placeHint: hints.placeHint, homeHint: hints.homeHint }, model }
    const tries: Try[] = []
    let final: { memo: string; scene: string; hookId: string | null } | null = null
    for (const temperature of [WRITE_TEMPERATURE, WRITE_RETRY_TEMPERATURE]) {
      const w = await generateWrite({ ...input, temperature })
      const verdict = checkMemo(w.memo, w.hookId, facts, hooks.map((h) => h.id), recent)
      tries.push({ temperature, memo: w.memo, scene: w.scene, hookId: w.hookId, verdict })
      if (verdict.ok) { final = { memo: w.memo, scene: w.scene, hookId: w.hookId }; break }
    }
    row.v2 = { seen, hooks, recentTitles: recent, style: data.style, tries, final, seconds: (Date.now() - t) / 1000 }
    process.stdout.write(`   see: ${seen.activity} | ${seen.subjects.join(', ')} | ${seen.setting}${seen.signText.length ? ` | "${seen.signText.join('", "')}"` : ''}\n`)
    for (const tr of tries) process.stdout.write(`   v2@${tr.temperature}: ${tr.memo}${tr.hookId ? ` [${tr.hookId}]` : ''} ${tr.verdict.ok ? '' : `✗ ${tr.verdict.reason}: ${tr.verdict.detail}`}\n`)
    if (!final) process.stdout.write('   v2:  both tries rejected → production would fall back to v1\n')
  } catch (err) {
    row.v2 = { error: String(err).slice(0, 160) }
    process.stdout.write(`   v2:  FAILED ${row.v2.error}\n`)
  }
  writeFileSync(join(out, 'memo-compare.json'), JSON.stringify({ projectId, patientUid, model, generatedAt: new Date().toISOString(), rows }, null, 2))
}
writeFileSync(join(out, 'memo-compare.html'), page(rows))
console.log(`\nwrote ${join(out, 'memo-compare.html')} — open it, pick the better memo per row, download the picks, then:\n  npm run memo-compare -- --results <picks.json>`)
factCheck(rows)
process.exit(0)

/** The v2 titles that name a number or place not in their own inputs (the guard's own test). */
function factCheck(rows: Row[]) {
  const bad: string[] = []
  for (const r of rows) {
    if ('error' in r.v2 || !r.v2.final) continue
    const facts = { texts: [...r.v2.seen.subjects, r.v2.seen.setting, ...r.v2.seen.signText, `${r.v2.seen.peopleCount}명`, areaOf(r.place), ...r.v2.hooks.map((h) => h.text)] }
    const v = checkMemo(r.v2.final.memo, r.v2.final.hookId, facts, r.v2.hooks.map((h) => h.id), [])
    if (!v.ok) bad.push(`${r.memoId}: "${r.v2.final.memo}" — ${v.reason}: ${v.detail}`)
  }
  console.log(bad.length ? `\n${bad.length} v2 memo(s) with a fact not in their inputs:\n  ${bad.join('\n  ')}` : '\nno v2 memo names a number or place outside its inputs')
}

function score(picksFile: string) {
  const data = JSON.parse(readFileSync(join(out, 'memo-compare.json'), 'utf8')) as { rows: Row[] }
  const picks = (JSON.parse(readFileSync(picksFile, 'utf8')) as { picks?: Record<string, string> }).picks ?? {}
  let v1 = 0, v2 = 0, tie = 0
  for (const r of data.rows) {
    const p = picks[r.memoId]
    if (p === 'v1') v1++; else if (p === 'v2') v2++; else if (p === 'tie') tie++
  }
  const decided = v1 + v2
  console.log(`${data.rows.length} rows, ${v1 + v2 + tie} picked: v2 ${v2} · v1 ${v1} · 무승부 ${tie}`)
  console.log(decided ? `v2 win rate: ${Math.round((100 * v2) / decided)}% of decided rows (${v2}/${decided})` : 'no decided rows yet')
  factCheck(data.rows)
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function page(rows: Row[]): string {
  const cell = (r: Row) => {
    const v1 = 'error' in r.v1 ? `<div class="err">v1 실패: ${esc(r.v1.error)}</div>` : `<div class="memo">${esc(r.v1.memo)}</div><div class="scene">${esc(r.v1.scene)}</div><div class="meta">${esc(r.v1.activity)} · ${r.v1.seconds.toFixed(0)}s</div>`
    let v2: string
    if ('error' in r.v2) v2 = `<div class="err">v2 실패: ${esc(r.v2.error)}</div>`
    else {
      const f = r.v2.final
      v2 = (f ? `<div class="memo">${esc(f.memo)}</div><div class="scene">${esc(f.scene)}</div>` : `<div class="err">두 번 다 거절됨 → 실제로는 v1로 대체</div>`)
        + `<div class="meta">${esc(r.v2.seen.activity)} · ${esc(r.v2.style)}${f?.hookId ? ` · hook ${esc(f.hookId)}` : ''} · ${r.v2.seconds.toFixed(0)}s</div>`
        + `<details><summary>본 것 · 이야기 · 시도</summary><div class="facts">본 것: ${esc([r.v2.seen.subjects.join(', '), r.v2.seen.setting, r.v2.seen.signText.map((t) => `"${t}"`).join(', '), `${r.v2.seen.peopleCount}명`].filter(Boolean).join(' | '))}</div>`
        + `<div class="facts">이야기: ${r.v2.hooks.map((h) => `[${esc(h.id)}] ${esc(h.text)}`).join(' · ') || '(없음)'}</div>`
        + r.v2.tries.map((t) => `<div class="facts">@${t.temperature}: ${esc(t.memo)}${t.hookId ? ` [${esc(t.hookId)}]` : ''} ${t.verdict.ok ? '✓' : `✗ ${esc(t.verdict.reason)}: ${esc(t.verdict.detail)}`}</div>`).join('')
        + '</details>'
    }
    return `<tr data-id="${esc(r.memoId)}">
<td class="photo">${r.photoUrl ? `<img src="${esc(r.photoUrl)}" loading="lazy">` : ''}<div class="meta">${esc(r.takenAt.slice(0, 16).replace('T', ' '))}<br>${esc(r.place)}</div><div class="now">지금: ${esc(r.current.memo)}</div></td>
<td>${v1}</td><td>${v2}</td>
<td class="pick"><button data-pick="v1">v1</button><button data-pick="v2">v2</button><button data-pick="tie">무승부</button></td></tr>`
  }
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>memo v1 vs v2</title>
<style>
body{font:15px/1.45 -apple-system,"Apple SD Gothic Neo","Nanum Gothic",sans-serif;margin:16px;color:#2c3a33;background:#f4f8f6}
h1{font-size:20px;margin:0 0 8px}#sum{margin:0 0 14px;font-weight:700}
table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #cfe3d8;padding:10px;vertical-align:top;width:30%}
th{background:#eaf6f0;text-align:left}td.photo{width:22%}td.pick{width:18%;white-space:nowrap}
img{width:100%;max-width:220px;border-radius:12px;display:block;margin-bottom:6px}
.memo{font-size:17px;font-weight:700;word-break:keep-all}.scene{margin-top:4px;word-break:keep-all}.meta{color:#4f6a5e;font-size:13px;margin-top:4px}.now{color:#4f6a5e;font-size:13px;margin-top:6px}
.err{color:#b23a3a}.facts{font-size:13px;color:#4f6a5e;margin-top:3px;word-break:keep-all}details{margin-top:6px}summary{font-size:13px;cursor:pointer;color:#4f6a5e}
button{font:inherit;padding:8px 12px;margin-right:4px;border:2px solid #cfe3d8;border-radius:12px;background:#fff;cursor:pointer}button.on{background:#ff8a1f;border-color:#ff8a1f;font-weight:700}
#dl{margin:14px 0}
</style>
<h1>메모 v1 (한 번에) vs v2 (보고 → 쓰기) — ${rows.length}장</h1>
<div id="sum"></div>
<table><tr><th>사진</th><th>v1</th><th>v2</th><th>더 나은 쪽</th></tr>${rows.map(cell).join('\n')}</table>
<div id="dl"><button id="download">결과 JSON 내려받기</button> <span class="meta">선택은 이 브라우저에 저장돼요. 내려받은 파일을 npm run memo-compare -- --results 로 넘기면 승률이 나와요.</span></div>
<script>
const KEY='memo-compare:picks';const picks=JSON.parse(localStorage.getItem(KEY)||'{}');
function paint(){let v1=0,v2=0,tie=0;document.querySelectorAll('tr[data-id]').forEach(tr=>{const p=picks[tr.dataset.id];tr.querySelectorAll('button[data-pick]').forEach(b=>b.classList.toggle('on',b.dataset.pick===p));if(p==='v1')v1++;else if(p==='v2')v2++;else if(p==='tie')tie++;});
const d=v1+v2;document.getElementById('sum').textContent=\`선택 \${v1+v2+tie}/\${document.querySelectorAll('tr[data-id]').length} — v2 \${v2} · v1 \${v1} · 무승부 \${tie}\${d?\` · v2 승률 \${Math.round(100*v2/d)}%\`:''}\`;}
document.querySelectorAll('button[data-pick]').forEach(b=>b.addEventListener('click',()=>{const id=b.closest('tr').dataset.id;picks[id]=picks[id]===b.dataset.pick?undefined:b.dataset.pick;localStorage.setItem(KEY,JSON.stringify(picks));paint();}));
document.getElementById('download').addEventListener('click',()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({picks},null,2)],{type:'application/json'}));a.download='memo-compare-picks.json';a.click();});
paint();
</script></html>`
}

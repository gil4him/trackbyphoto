// Compare today's description with the memoDiary scene (llm/prompt.ts) on a
// parent's real photos, side by side, before the flag is turned on:
//
//   npm run memo-diary-compare -- [--patient <uid> | --all] [--n 30] [--out <dir>]
//   npm run memo-diary-compare -- --results <picks.json>     (score an earlier run)
//
// Reads production Firestore and Storage (never writes a memo), runs the
// Mac mini's model twice per photo (classic, then diary), and writes
// <out>/memo-diary-compare.{json,html}. The page has 지금 방식 / 일기 / 무승부
// buttons per row (kept in the browser) and downloads the picks as JSON.
// Each diary is checked for the slips the prompt forbids: a missing or wrong
// date, 1st person, and smells/tastes/feelings a photo can't show.
// Default out: ~/.trackbyphoto/memo-diary-compare. The photos stay private.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { generateMemo } from '../llm/ollama.js'
import { areaOf, readableText, type VisionTags } from '../llm/prompt.js'
import { homeHintFor, localDateHint, localTimeHint } from '../travel.js'

type Out = { activity: string; memo: string; scene: string; seconds: number } | { error: string }
interface Row {
  memoId: string
  photoUrl: string
  takenAt: string
  place: string
  dateHint: string
  classic: Out
  diary: Out
  flags: string[]
}

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const out = arg('out', join(homedir(), '.trackbyphoto', 'memo-diary-compare'))!
mkdirSync(out, { recursive: true })

if (arg('results')) {
  score(arg('results')!)
  process.exit(0)
}

const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), '.trackbyphoto', 'sa-key.json')
const projectId = (JSON.parse(readFileSync(keyFile, 'utf8')) as { project_id: string }).project_id
initializeApp({ credential: cert(keyFile), storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app` })
const db = getFirestore()
const n = Number(arg('n', '30'))
const model = process.env.OLLAMA_MODEL || 'gemma4:e4b'

const onePatient = process.argv.includes('--all') ? null : arg('patient') || null
const query = onePatient ? db.collection('memos').where('patientUid', '==', onePatient) : db.collection('memos')
const snap = await query.orderBy('takenAt', 'desc').limit(n * 3).get()
const memos = snap.docs.filter((d) => d.get('status') === 'ready' && d.get('photoPath')).slice(0, n)
console.log(`${projectId}: ${onePatient ? `patient ${onePatient.slice(0, 8)}…` : 'every parent'}, ${memos.length} photos, model ${model}, out ${out}`)

const rows: Row[] = []
for (const [i, d] of memos.entries()) {
  const m = d.data()
  const patientUid = m.patientUid as string
  const takenAt = (m.takenAt as Timestamp).toDate()
  const lat = typeof m.lat === 'number' ? (m.lat as number) : null
  const lng = typeof m.lng === 'number' ? (m.lng as number) : null
  const tz = m.tzOffsetMin as number | undefined
  const tags = (m.tags as VisionTags | undefined) ?? null
  const dateHint = (await localDateHint(patientUid, takenAt, lat, lng, tz)) ?? ''
  const row: Row = { memoId: d.id, photoUrl: (m.photoUrl as string) || '', takenAt: takenAt.toISOString(), place: (m.place as string) || '', dateHint, classic: { error: 'not run' }, diary: { error: 'not run' }, flags: [] }
  rows.push(row)
  process.stdout.write(`\n[${i + 1}/${memos.length}] ${d.id} ${dateHint} ${row.place || '(no place)'}\n`)
  let imageBase64: string
  try {
    imageBase64 = (await getStorage().bucket().file(m.photoPath as string).download())[0].toString('base64')
  } catch (err) {
    row.classic = row.diary = { error: `photo: ${String(err).slice(0, 120)}` }
    continue
  }
  const hints = {
    timeHint: await localTimeHint(patientUid, takenAt, lat, lng, tz),
    placeHint: areaOf((m.place as string) || '') || undefined,
    homeHint: await homeHintFor(patientUid, lat, lng),
    textHint: readableText(tags?.text),
  }
  for (const kind of ['classic', 'diary'] as const) {
    const t = Date.now()
    try {
      const r = await generateMemo({ ...hints, imageBase64, model, ...(kind === 'diary' ? { diary: true, dateHint } : {}) })
      row[kind] = { activity: r.activity, memo: r.memo, scene: r.scene, seconds: (Date.now() - t) / 1000 }
      process.stdout.write(`   ${kind === 'diary' ? '일기' : '지금'} (${((Date.now() - t) / 1000).toFixed(0)}s): ${r.memo} | ${r.scene}\n`)
    } catch (err) {
      row[kind] = { error: String(err).slice(0, 160) }
      process.stdout.write(`   ${kind}: FAILED ${String(err).slice(0, 160)}\n`)
    }
  }
  row.flags = check(row)
  if (row.flags.length) process.stdout.write(`   ⚠ ${row.flags.join(' · ')}\n`)
  writeFileSync(join(out, 'memo-diary-compare.json'), JSON.stringify({ projectId, model, generatedAt: new Date().toISOString(), rows }, null, 2))
}
writeFileSync(join(out, 'memo-diary-compare.html'), page(rows))
console.log(`\nwrote ${join(out, 'memo-diary-compare.html')}`)
summary(rows)
process.exit(0)

/** What the diary prompt forbids, found in one row's diary. */
function check(r: Row): string[] {
  if ('error' in r.diary) return ['실패']
  const s = r.diary.scene
  const flags: string[] = []
  const [, month, day] = r.dateHint.match(/^(\d+)월 (\d+)일/) ?? []
  const first = s.split(/(?<=[가-힣][.!?])\s+/)[0] ?? ''
  if (month && !first.includes(`${month}월 ${day}일`)) flags.push('첫 문장에 날짜 없음')
  for (const [, mm, dd] of s.matchAll(/(\d+)월 (\d+)일/g)) if (mm !== month || dd !== day) flags.push(`다른 날짜 ${mm}월 ${dd}일`)
  if (/(^|[\s,.])(나는|내가|나의|저는|제가|저의|우리)/.test(s)) flags.push('1인칭')
  const sense = s.match(/향긋|향이|냄새|맛있|맛이|고소|달콤|즐거|행복|기분|신나|설레|뿌듯|소리가/g)
  if (sense) flags.push(`감각·기분 "${[...new Set(sense)].join('", "')}"`)
  const sentences = s.split(/(?<=[가-힣][.!?])\s+/).filter(Boolean).length
  if (sentences < 3 && !/흐려|알 수 없/.test(s)) flags.push(`${sentences}문장`)
  return flags
}

function summary(rows: Row[]) {
  const ok = rows.filter((r) => !('error' in r.diary))
  const secs = (k: 'classic' | 'diary') => {
    const v = rows.map((r) => r[k]).filter((o): o is Extract<Out, { seconds: number }> => !('error' in o)).map((o) => o.seconds).sort((a, b) => a - b)
    return v.length ? v[Math.floor(v.length / 2)].toFixed(1) : '-'
  }
  const flagged = rows.filter((r) => r.flags.length)
  console.log(`${ok.length}/${rows.length} diaries written · median seconds: 지금 ${secs('classic')}s, 일기 ${secs('diary')}s`)
  console.log(flagged.length ? `${flagged.length} diar${flagged.length === 1 ? 'y' : 'ies'} flagged:\n  ${flagged.map((r) => `${r.memoId}: ${r.flags.join(' · ')}`).join('\n  ')}` : 'no diary flagged')
}

function score(picksFile: string) {
  const data = JSON.parse(readFileSync(join(out, 'memo-diary-compare.json'), 'utf8')) as { rows: Row[] }
  const picks = (JSON.parse(readFileSync(picksFile, 'utf8')) as { picks?: Record<string, string> }).picks ?? {}
  let classic = 0, diary = 0, tie = 0
  for (const r of data.rows) {
    const p = picks[r.memoId]
    if (p === 'classic') classic++; else if (p === 'diary') diary++; else if (p === 'tie') tie++
  }
  console.log(`${data.rows.length} rows, ${classic + diary + tie} picked: 일기 ${diary} · 지금 방식 ${classic} · 무승부 ${tie}`)
  summary(data.rows)
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function page(rows: Row[]): string {
  const cell = (o: Out) => 'error' in o
    ? `<div class="err">실패: ${esc(o.error)}</div>`
    : `<div class="memo">${esc(o.memo)}</div><div class="scene">${esc(o.scene)}</div><div class="meta">${esc(o.activity)} · ${o.seconds.toFixed(0)}s</div>`
  const row = (r: Row) => `<tr data-id="${esc(r.memoId)}">
<td class="photo">${r.photoUrl ? `<img src="${esc(r.photoUrl)}" loading="lazy">` : ''}<div class="meta">${esc(r.dateHint)}<br>${esc(r.place)}</div></td>
<td>${cell(r.classic)}</td><td>${cell(r.diary)}${r.flags.length ? `<div class="flag">⚠ ${esc(r.flags.join(' · '))}</div>` : ''}</td>
<td class="pick"><button data-pick="classic">지금 방식</button><button data-pick="diary">일기</button><button data-pick="tie">무승부</button></td></tr>`
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>메모: 지금 방식 vs 일기</title>
<style>
body{font:15px/1.5 -apple-system,"Apple SD Gothic Neo","Nanum Gothic",sans-serif;margin:16px;color:#2c3a33;background:#f4f8f6}
h1{font-size:20px;margin:0 0 8px}#sum{margin:0 0 14px;font-weight:700}
table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #cfe3d8;padding:10px;vertical-align:top;width:30%}
th{background:#eaf6f0;text-align:left}td.photo{width:22%}td.pick{width:18%}
img{width:100%;max-width:220px;border-radius:12px;display:block;margin-bottom:6px}
.memo{font-size:17px;font-weight:700;word-break:keep-all}.scene{margin-top:4px;word-break:keep-all}.meta{color:#4f6a5e;font-size:13px;margin-top:4px}
.err,.flag{color:#b23a3a;font-size:13px;margin-top:6px}
button{font:inherit;padding:8px 12px;margin:0 4px 4px 0;border:2px solid #cfe3d8;border-radius:12px;background:#fff;cursor:pointer}button.on{background:#ff8a1f;border-color:#ff8a1f;font-weight:700}
#dl{margin:14px 0}
</style>
<h1>사진 메모: 지금 방식 vs 일기 — ${rows.length}장</h1>
<div id="sum"></div>
<table><tr><th>사진</th><th>지금 방식</th><th>일기</th><th>더 나은 쪽</th></tr>${rows.map(row).join('\n')}</table>
<div id="dl"><button id="download">결과 JSON 내려받기</button> <span class="meta">선택은 이 브라우저에 저장돼요.</span></div>
<script>
const KEY='memo-diary-compare:picks';let picks={};try{picks=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
function paint(){let c=0,d=0,t=0;document.querySelectorAll('tr[data-id]').forEach(tr=>{const p=picks[tr.dataset.id];tr.querySelectorAll('button[data-pick]').forEach(b=>b.classList.toggle('on',b.dataset.pick===p));if(p==='classic')c++;else if(p==='diary')d++;else if(p==='tie')t++;});
document.getElementById('sum').textContent=\`선택 \${c+d+t}/\${document.querySelectorAll('tr[data-id]').length} — 일기 \${d} · 지금 방식 \${c} · 무승부 \${t}\`;}
document.querySelectorAll('button[data-pick]').forEach(b=>b.addEventListener('click',()=>{const id=b.closest('tr').dataset.id;picks[id]=picks[id]===b.dataset.pick?undefined:b.dataset.pick;try{localStorage.setItem(KEY,JSON.stringify(picks))}catch(e){}paint();}));
document.getElementById('download').addEventListener('click',()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({picks},null,2)],{type:'application/json'}));a.download='memo-diary-picks.json';a.click();});
paint();
</script></html>`
}

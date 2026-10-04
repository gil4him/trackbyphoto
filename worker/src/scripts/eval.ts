// Score the memo prompt on a fixed set of real photos, so a prompt or model
// change is judged on all of them at once instead of on one lucky run:
//   npm run eval -- [dir]        (default ~/.trackbyphoto/eval)
// The directory holds the photos and cases.json. It lives outside the repo
// because the photos are private. A case:
//   { "file": "banner.jpg", "what": "banner in title",
//     "hints": { "placeHint": "도코나메시, 일본", "homeHint": { "km": 900, "away": true } },
//     "text": ["Aichi-", "Nagoya"],             // on-phone OCR, as stored in tags.text
//     "activityIn": ["이동", "여행"],            // optional
//     "memoMatches": "Aichi|나고야",             // optional regex on the title
//     "anyMatches": "...", "noneMatches": "..."  // optional regexes on title + description
//   }
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { generateMemo } from '../llm/ollama.js'
import { readableText, type PromptHints } from '../llm/prompt.js'

interface Case {
  file: string
  what: string
  hints?: PromptHints
  text?: string[]
  activityIn?: string[]
  memoMatches?: string
  anyMatches?: string
  noneMatches?: string
}

const dir = process.argv[2] || join(homedir(), '.trackbyphoto', 'eval')
const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8')) as Case[]
const model = process.env.OLLAMA_MODEL || 'gemma4:e4b'

let pass = 0
for (const c of cases) {
  try {
    const r = await generateMemo({
      imageBase64: readFileSync(join(dir, c.file)).toString('base64'),
      model,
      timeHint: '12:30',
      ...c.hints,
      textHint: readableText(c.text),
    })
    const all = `${r.memo} ${r.scene}`
    const ok = (!c.activityIn || c.activityIn.includes(r.activity))
      && (!c.memoMatches || new RegExp(c.memoMatches, 'i').test(r.memo))
      && (!c.anyMatches || new RegExp(c.anyMatches, 'i').test(all))
      && (!c.noneMatches || !new RegExp(c.noneMatches, 'i').test(all))
    if (ok) pass++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.what}: ${r.activity} | ${r.memo} | ${r.scene}`)
  } catch (err) {
    console.log(`FAIL ${c.what}: ${String(err).slice(0, 120)}`)
  }
}
console.log(`score ${pass}/${cases.length} (${model})`)
process.exit(pass === cases.length ? 0 : 1)

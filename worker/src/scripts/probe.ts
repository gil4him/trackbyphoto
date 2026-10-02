// Smoke-test the memo prompt on a local photo without Firebase:
//   npm run probe -- path/to/photo.jpg [model] [HH:MM] [place]
import { readFileSync } from 'node:fs'
import { generateMemo } from '../llm/ollama.js'

const [path, model = process.env.OLLAMA_MODEL || 'gemma4:e4b', timeHint, placeHint] = process.argv.slice(2)
if (!path) {
  console.error('usage: npm run probe -- <photo> [model] [HH:MM] [place]')
  process.exit(2)
}
const started = Date.now()
const result = await generateMemo({ imageBase64: readFileSync(path).toString('base64'), model, timeHint, placeHint })
console.log(JSON.stringify({ ...result, memoChars: [...result.memo].length, seconds: (Date.now() - started) / 1000 }, null, 2))

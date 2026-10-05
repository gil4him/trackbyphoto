// The two small servers the check needs besides the emulators: the built
// site (served the way Firebase Hosting serves it) and a stand-in for the
// local AI model, so memos are written instantly and the same way every run.

import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }

/** Same cache headers and rewrite-to-index.html as firebase.json. */
export function serveSite(root, port) {
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    const file = path === '/' || !extname(path) ? '/index.html' : path
    try {
      const body = await readFile(join(root, file))
      const immutable = /\.(js|css|woff2|svg|png|jpg|webp|ico)$/.test(file) && !file.endsWith('sw.js')
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': immutable ? 'public,max-age=31536000,immutable' : 'no-cache' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

export const FAKE_MEMO = { activity: '산책', memo: '나무가 있는 공원 산책길', scene: '공원 길을 따라 나무가 서 있어요. 날씨가 맑아요.' }
export const FAKE_SUMMARY = '오늘은 공원을 산책하며 사진을 남기셨어요.'

/** Answers the two Ollama calls the worker makes (/api/tags, /api/generate). */
export function serveFakeModel(port) {
  const server = http.createServer((req, res) => {
    const json = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.url.startsWith('/api/tags')) return json({ models: [{ name: 'gemma4:e4b', model: 'gemma4:e4b' }] })
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw) } catch { /* not JSON */ }
      const answer = Array.isArray(body.images) && body.images.length ? FAKE_MEMO : { summary: FAKE_SUMMARY }
      json({ model: body.model, response: JSON.stringify(answer), done: true, prompt_eval_count: 10, eval_count: 10 })
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

/**
 * Local speech-to-text for the parent's voice replies (whisper.cpp).
 *
 * Same contract as llm/ollama.ts: sttAvailable() says whether it can run at
 * all, transcribe() throws SttUnavailableError when the tool or model is
 * missing (retry later, doesn't count as an attempt) and SttError when a run
 * failed (counts). Nothing leaves the Mac mini. Set up with
 * scripts/install-stt.sh.
 *
 * The phone records webm/opus (Android, Chrome) or mp4/aac (iPhone); ffmpeg
 * turns either into the 16 kHz mono WAV whisper.cpp reads.
 */

import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const WHISPER_BIN = process.env.WHISPER_BIN || '/opt/homebrew/bin/whisper-cli'
const WHISPER_MODEL = process.env.WHISPER_MODEL || join(homedir(), '.trackbyphoto', 'models', 'ggml-large-v3-turbo.bin')
// Voice-activity model. Without it whisper "hears" phrases like 감사합니다 in
// silence or room noise, which would be shown as the parent's words.
const VAD_MODEL = process.env.WHISPER_VAD_MODEL || join(homedir(), '.trackbyphoto', 'models', 'ggml-silero-v5.1.2.bin')
const FFMPEG_BIN = process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg'
/** A reply is at most 15 s; anything longer is cut before transcription. */
const MAX_CLIP_SECONDS = 20
const TIMEOUT_MS = 120_000
export const TRANSCRIPT_MAX = 200

export class SttUnavailableError extends Error {}
export class SttError extends Error {}

const exists = (path: string) => access(path).then(() => true, () => false)

export async function sttAvailable(): Promise<boolean> {
  return (await Promise.all([WHISPER_BIN, WHISPER_MODEL, VAD_MODEL, FFMPEG_BIN].map(exists))).every(Boolean)
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new SttError(`${bin} failed: ${String(stderr || err.message).slice(-300)}`))
      else resolve(stdout)
    })
  })
}

/** Things whisper prints for silence or noise instead of speech. */
const NOT_SPEECH = [
  /\[[^\]]*\]/g,           // [음악], [BLANK_AUDIO]
  /\([^)]*\)/g,            // (박수)
  /\*[^*]*\*/g,            // *웃음*
  /♪+/g,
]
const SILENCE_PHRASES = [
  /시청해\s*주셔서 감사합니다\.?/g,
  /구독과 좋아요[^.]*\.?/g,
  /다음 영상에서 만나요\.?/g,
  /MBC 뉴스 [^.]*입니다\.?/g,
]

/** One clean line, at most TRANSCRIPT_MAX characters. '' when nothing was said. */
export function tidyTranscript(raw: string): string {
  let text = raw
  for (const re of [...NOT_SPEECH, ...SILENCE_PHRASES]) text = text.replace(re, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > TRANSCRIPT_MAX ? `${text.slice(0, TRANSCRIPT_MAX - 1)}…` : text
}

/** Transcribe one Korean voice clip. */
export async function transcribe(audio: Buffer): Promise<string> {
  if (!(await sttAvailable())) throw new SttUnavailableError('whisper.cpp, its models or ffmpeg are not installed (scripts/install-stt.sh)')
  const dir = await mkdtemp(join(tmpdir(), 'tbp-voice-'))
  try {
    const input = join(dir, 'clip')
    const wav = join(dir, 'clip.wav')
    await writeFile(input, audio)
    await run(FFMPEG_BIN, ['-nostdin', '-loglevel', 'error', '-y', '-i', input, '-t', String(MAX_CLIP_SECONDS), '-ar', '16000', '-ac', '1', wav])
    const out = await run(WHISPER_BIN, ['-m', WHISPER_MODEL, '-f', wav, '-l', 'ko', '-nt', '-np', '--vad', '-vm', VAD_MODEL])
    return tidyTranscript(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

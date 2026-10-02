// Minimal structured logger. launchd captures stdout/stderr into
// ~/Library/Logs/trackbyphoto-worker.log, so one JSON-ish line per event keeps
// that file greppable (e.g. `grep '\[llm-cost\]'`).

type Fields = Record<string, unknown>

function emit(level: 'info' | 'warn' | 'error', msg: string, fields?: Fields) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}${fields ? ' ' + JSON.stringify(fields) : ''}`
  if (level === 'info') console.log(line)
  else console.error(line)
}

export const logger = {
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
}

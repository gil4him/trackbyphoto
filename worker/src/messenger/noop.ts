import { logger } from '../log.js'
import type { MessengerProvider } from './index.js'

/** Used when no messenger account is configured: says what it would have sent. */
export const noop: MessengerProvider = {
  name: 'noop',
  async send(to, template) {
    logger.info('[messenger] no provider configured; nothing sent', { template, to: `${to.slice(0, 5)}…` })
    return { ok: false, provider: 'noop' }
  },
}

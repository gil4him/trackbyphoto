// E-mail delivery of the digest, over any SMTP account.
// Env: SMTP_URL (e.g. smtps://user:app-password@smtp.gmail.com) and MAIL_FROM
// ("오늘하루 <name@example.com>"). Without both, no e-mail is sent.

import nodemailer from 'nodemailer'
import { logger } from './log.js'

export interface Mail { to: string; subject: string; text: string }
export interface Mailer { send(mail: Mail): Promise<boolean> }

/** The configured mailer, or null when e-mail isn't set up. */
export function mailerFromEnv(env: Record<string, string | undefined> = process.env): Mailer | null {
  const url = env.SMTP_URL
  const from = env.MAIL_FROM
  if (!url || !from) return null
  const transport = nodemailer.createTransport(url)
  return {
    async send({ to, subject, text }) {
      try {
        await transport.sendMail({ from, to, subject, text })
        return true
      } catch (err) {
        logger.warn('[mail] send failed', { err: String(err) })
        return false
      }
    },
  }
}

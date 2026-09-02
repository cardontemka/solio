import 'server-only'

import nodemailer from 'nodemailer'
import { emailFrom, gmailSmtpConfig } from './config'

/**
 * A single lazy transport shared across requests. Created once on first use
 * and reused; nodemailer recreates TLS implicitly when a connection drops.
 */
let transporter: nodemailer.Transporter | null = null

export function isEmailEnabled(): boolean {
  return gmailSmtpConfig() !== null
}

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter
  const config = gmailSmtpConfig()
  if (!config) throw new Error('Gmail SMTP is not configured')
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // STARTTLS on 587
    auth: { user: config.user, pass: config.pass },
  })
  return transporter
}

/**
 * Send one email. Returns { ok } or { ok:false, error }. Never throws, so a
 * failed notification mail can't break the action that triggered it.
 */
export async function sendMail(opts: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = gmailSmtpConfig()
  if (!config) return { ok: true } // silently skip when unconfigured

  try {
    const tx = getTransporter()
    await tx.sendMail({
      from: emailFrom(),
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    })
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[mailer] failed to send', { to: opts.to, subject: opts.subject, error: message })
    return { ok: false, error: message }
  }
}
import 'server-only'

/**
 * Gmail SMTP connectivity for notification emails.
 *
 * Creates a Gmail App Password at https://myaccount.google.com/apppasswords
 * and set GMAIL_SMTP_USER / GMAIL_SMTP_PASS. When they're absent the mailer
 * becomes a no-op so the rest of the app keeps working unchanged.
 */
export function gmailSmtpConfig(): {
  user: string
  pass: string
} | null {
  const user = process.env.GMAIL_SMTP_USER
  const pass = process.env.GMAIL_SMTP_PASS
  if (!user || !pass) return null
  return { user, pass }
}

export function emailFrom(): string {
  const user = process.env.GMAIL_SMTP_USER
  if (user) return `Solio <${user}>`
  return 'Solio <no-reply@solio.mn>'
}
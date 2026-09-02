import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { publicEnv } from '@/lib/validation/env'
import { NOTIFICATION_COPY, notificationHrefFor, type NotificationType } from '@/features/notifications/content'
import { isEmailEnabled, sendMail } from './mailer'

function buildEmail(type: NotificationType, href: string | null, siteUrl: string) {
  const copy = NOTIFICATION_COPY[type] ?? { title: type }
  const title = copy.title
  const body = copy.body ?? 'Дэлгэрэнгүй мэдээллийг Solio-д үзээрэй.'
  const link = href ? `${siteUrl}${href}` : null

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#2b2b2b;max-width:520px">
      <h2 style="margin:0 0 12px;color:#e76f51">${title}</h2>
      <p style="margin:0 0 20px;color:#555">${body}</p>
      ${link ? `<p><a href="${link}" style="display:inline-block;background:#e76f51;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600">Нээх</a></p>` : ''}
      <p style="margin:32px 0 0;font-size:12px;color:#999">Solio — ном солилцооны платформ</p>
    </div>
  `

  return { subject: `Solio · ${title}`, text: `${title}\n${body}`, html }
}

/**
 * Resolve a user's account email via the Admin API. We deliberately do NOT
 * select from auth.users — that domain is locked down (see security.md §10.2);
 * the supported way to read another account's email is auth.admin, which also
 * works for Google (OAuth) sign-ups because those populate auth.users.email.
 */
async function resolveEmail(userId: string): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient().auth.admin.getUserById(userId)
    if (error || !data.user) return null
    return data.user?.email ?? null
  } catch (e) {
    console.error('[email] resolveEmail failed', e)
    return null
  }
}

/**
 * Email one notification recipient. Best-effort: never throws and never blocks
 * the action in progress — a missing mailbox or a failed send is logged, not
 * surfaced to the caller.
 */
export async function emailNotification(opts: {
  userId: string
  type: NotificationType
  entityType: string
  entityId: string
}): Promise<void> {
  if (!isEmailEnabled()) return
  const email = await resolveEmail(opts.userId)
  if (!email) return

  const href = notificationHrefFor(opts.entityType, opts.entityId)
  const { subject, text, html } = buildEmail(opts.type, href, publicEnv.siteUrl)
  await sendMail({ to: email, subject, text, html })
}
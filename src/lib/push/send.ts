import 'server-only'

import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'
import { publicEnv } from '@/lib/validation/env'
import { NOTIFICATION_COPY, notificationHrefFor, type NotificationType } from '@/features/notifications/content'
import { vapidConfig } from './config'

/**
 * Delivers the notifications nobody has pushed yet.
 *
 * The queue is the notifications table: emit_event already decided who to tell,
 * so rather than every RPC reporting its recipients back to the application,
 * this drains rows with pushed_at IS NULL. One place sends, one place marks.
 *
 * Runs as the service role because it reads other people's notifications and
 * their subscriptions by design; it is never reachable from a request the user
 * controls — only from `after()` at the end of an action.
 */
type QueueRow = {
  id: number
  user_id: string
  type: NotificationType
  entity_type: string
  entity_id: string
  payload: { comment_id?: string } | null
}

type SubRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

const BATCH = 50

export async function flushPendingPush(): Promise<void> {
  const config = vapidConfig()
  if (!config) return

  const admin = createAdminClient()
  const { data: pending, error } = await admin
    .from('notifications')
    .select('id, user_id, type, entity_type, entity_id, payload')
    .is('pushed_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH)
  if (error || !pending?.length) return

  const rows = pending as QueueRow[]
  const userIds = [...new Set(rows.map((r) => r.user_id))]

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  const byUser = new Map<string, SubRow[]>()
  for (const s of (subs ?? []) as SubRow[]) {
    const list = byUser.get(s.user_id) ?? []
    list.push(s)
    byUser.set(s.user_id, list)
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)

  const site = publicEnv.siteUrl.replace(/\/+$/, '')
  const dead: string[] = []

  await Promise.all(
    rows.map(async (row) => {
      const targets = byUser.get(row.user_id) ?? []
      if (targets.length === 0) return

      const copy = NOTIFICATION_COPY[row.type] ?? { title: 'Solio' }
      const href = notificationHrefFor(row.entity_type, row.entity_id, row.payload) ?? '/notifications'
      const payload = JSON.stringify({
        title: copy.title,
        body: copy.body ?? 'Solio дээр шинэ мэдэгдэл байна.',
        url: `${site}${href}`,
        tag: `${row.type}-${row.entity_id}`,
      })

      await Promise.all(
        targets.map(async (t) => {
          try {
            await webpush.sendNotification(
              { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
              payload,
              { TTL: 60 * 60 * 24 }
            )
          } catch (e) {
            // 404/410 mean the browser dropped the subscription — the row is
            // now undeliverable for good and keeping it would retry forever.
            const status = (e as { statusCode?: number }).statusCode
            if (status === 404 || status === 410) dead.push(t.id)
            else console.error('[push] send failed', status, (e as Error).message)
          }
        })
      )
    })
  )

  // Marked regardless of delivery: a push that failed is not worth retrying
  // against the same dead endpoint, and the notification is already in the
  // in-app list either way.
  await admin
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .in('id', rows.map((r) => r.id))

  if (dead.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', dead)
  }
}

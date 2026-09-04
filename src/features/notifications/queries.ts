import 'server-only'

import { createClient } from '@/lib/supabase/server'
import {
  NOTIFICATION_COPY,
  notificationHrefFor,
  type NotificationType,
} from './content'

/**
 * Notifications are written by private.emit_event() inside the same
 * transaction as the change they describe, so a rolled-back swap never leaves
 * a phantom entry here.
 *
 * RLS limits every row to its recipient; these queries add no owner filter.
 */

export type NotificationView = {
  id: number
  type: NotificationType
  title: string
  body: string | null
  href: string | null
  createdAt: string
  isRead: boolean
}

type Row = {
  id: number
  type: NotificationType
  entity_type: string
  entity_id: string
  payload: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

export async function getNotifications(limit = 50): Promise<NotificationView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, entity_type, entity_id, payload, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  return ((data ?? []) as Row[]).map((n) => {
    const copy = NOTIFICATION_COPY[n.type] ?? { title: n.type }
    return {
      id: n.id,
      type: n.type,
      title: copy.title,
      body: copy.body ?? null,
      href: notificationHrefFor(n.entity_type, n.entity_id, n.payload),
      createdAt: n.created_at,
      isRead: n.read_at !== null,
    }
  })
}

export async function getUnreadCount(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) return 0
  return count ?? 0
}

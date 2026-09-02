import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Notifications are written by private.emit_event() inside the same
 * transaction as the change they describe, so a rolled-back swap never leaves
 * a phantom entry here.
 *
 * RLS limits every row to its recipient; these queries add no owner filter.
 */

export type NotificationType =
  | 'swap_requested' | 'swap_accepted' | 'swap_rejected' | 'swap_cancelled'
  | 'swap_confirmed' | 'swap_completed' | 'wishlist_match'
  | 'review_received' | 'report_resolved' | 'moderation_action'

export type NotificationView = {
  id: number
  type: NotificationType
  title: string
  body: string | null
  href: string | null
  createdAt: string
  isRead: boolean
}

/** What each event means to the person receiving it. */
const COPY: Record<NotificationType, { title: string; body?: string }> = {
  swap_requested: {
    title: 'Шинэ солилцооны хүсэлт',
    body: 'Хэн нэгэн таны номыг солилцохыг хүсч байна.',
  },
  swap_accepted: {
    title: 'Хүсэлтийг хүлээн авлаа',
    body: 'Номоо биечлэн солилцоод баталгаажуулна уу.',
  },
  swap_rejected: { title: 'Хүсэлтээс татгалзсан' },
  swap_cancelled: { title: 'Солилцоо цуцлагдсан' },
  swap_confirmed: {
    title: 'Нөгөө тал гардуулснаа баталгаажуулав',
    body: 'Таны баталгаажуулалт солилцоог дуусгана.',
  },
  swap_completed: {
    title: 'Солилцоо амжилттай дууслаа',
    body: 'Өмчлөл шилжиж, түүхэнд бүртгэгдлээ.',
  },
  wishlist_match: {
    title: 'Хүссэн ном тань нэмэгдлээ',
    body: 'Хүслийн жагсаалтад тохирох ном системд орлоо.',
  },
  review_received: { title: 'Таны номд шинэ сэтгэгдэл' },
  report_resolved: { title: 'Таны гомдол шийдвэрлэгдлээ' },
  moderation_action: { title: 'Модерацийн шийдвэр' },
}

function hrefFor(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case 'swap':
      return '/swaps'
    case 'book':
      return `/books/${entityId}`
    case 'book_copy':
      return '/my-books'
    default:
      return null
  }
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
    const copy = COPY[n.type] ?? { title: n.type }
    return {
      id: n.id,
      type: n.type,
      title: copy.title,
      body: copy.body ?? null,
      href: hrefFor(n.entity_type, n.entity_id),
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

/**
 * Shared copy for a notification type, used both to render the in-app item
 * and to compose the email body. Kept here so the two stay in step.
 */
export type NotificationType =
  | 'swap_requested' | 'swap_accepted' | 'swap_rejected' | 'swap_cancelled'
  | 'swap_confirmed' | 'swap_completed'
  | 'comment_received' | 'report_resolved' | 'moderation_action'

export const NOTIFICATION_COPY: Record<NotificationType, { title: string; body?: string }> = {
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
    title: 'Нөгөө тал биечлэн авсныг баталгаажуулав',
    body: 'Таны баталгаажуулалт солилцоог дуусгана.',
  },
  swap_completed: {
    title: 'Солилцоо амжилттай дууслаа',
    body: 'Өмчлөл шилжиж, түүхэнд бүртгэгдлээ.',
  },
  comment_received: {
    title: 'Шинэ сэтгэгдэл',
    body: 'Таны ном эсвэл хүсэлт дээр хэн нэгэн сэтгэгдэл бичлээ.',
  },
  report_resolved: { title: 'Таны гомдол шийдвэрлэгдлээ' },
  moderation_action: { title: 'Модерацийн шийдвэр' },
}

/**
 * Where a notification takes you — down to the row it is about.
 *
 * A link to the top of a busy page leaves the reader hunting for what changed,
 * so the anchor names the comment or the swap. The payload carries the comment
 * id because the notification's own entity is the thread it lives in.
 */
export function notificationHrefFor(
  entityType: string,
  entityId: string,
  payload?: { comment_id?: string } | null
): string | null {
  const anchor = payload?.comment_id ? `#comment-${payload.comment_id}` : ''
  switch (entityType) {
    case 'swap':
      return `/swaps#swap-${entityId}`
    case 'book':
      // A books id, not a listing id — /books/[copyId] resolves it to one.
      return `/books/${entityId}${anchor}`
    case 'request':
      return `/requests/${entityId}${anchor}`
    case 'book_copy':
      // A listing has its own page now.
      return `/books/${entityId}${anchor}`
    default:
      return null
  }
}
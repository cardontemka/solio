/**
 * Shared copy for a notification type, used both to render the in-app item
 * and to compose the email body. Kept here so the two stay in step.
 */
export type NotificationType =
  | 'swap_requested' | 'swap_accepted' | 'swap_rejected' | 'swap_cancelled'
  | 'swap_confirmed' | 'swap_completed'
  | 'comment_received' | 'report_filed' | 'report_resolved' | 'moderation_action'
  | 'claim_requested' | 'claim_approved' | 'claim_rejected'

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
  report_filed: {
    title: 'Шинэ гомдол',
    body: 'Хэрэглэгч контент дээр гомдол гаргалаа — админ хэсгээс шалгана уу.',
  },
  report_resolved: { title: 'Таны гомдол шийдвэрлэгдлээ' },
  moderation_action: { title: 'Модерацийн шийдвэр' },
  claim_requested: {
    title: 'Хэн нэгэн таны зүйлийг авлаа гэж байна',
    body: 'Зөвшөөрөх эсэхийг шийднэ үү — зөвшөөрснөөр байршил эсвэл эзэмшил шилжинэ.',
  },
  claim_approved: {
    title: 'Хүсэлтийг тань зөвшөөрлөө',
    body: 'Тухайн зүйл одоо таны бүртгэлд байна.',
  },
  claim_rejected: { title: 'Хүсэлтээс тань татгалзлаа' },
}

/**
 * Where a notification takes you — down to the row it is about.
 *
 * A link to the top of a busy page leaves the reader hunting for what changed,
 * so the anchor names the comment or the swap. The payload carries the comment
 * id because the notification's own entity is the thread it lives in.
 */
export function notificationHrefFor(
  type: NotificationType | string,
  entityType: string,
  entityId: string,
  payload?: { comment_id?: string } | null
): string | null {
  const anchor = payload?.comment_id ? `#comment-${payload.comment_id}` : ''

  // A report has two audiences and they belong on different pages: the staff who
  // must act on it, and the person who filed it. Only the first has anywhere to
  // go — sending a reporter to /admin/reports would bounce them off a page they
  // cannot open.
  if (entityType === 'report') {
    return type === 'report_filed' ? `/admin/reports#report-${entityId}` : null
  }

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
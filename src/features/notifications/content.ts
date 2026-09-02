/**
 * Shared copy for a notification type, used both to render the in-app item
 * and to compose the email body. Kept here so the two stay in step.
 */
export type NotificationType =
  | 'swap_requested' | 'swap_accepted' | 'swap_rejected' | 'swap_cancelled'
  | 'swap_confirmed' | 'swap_completed' | 'wishlist_match'
  | 'review_received' | 'report_resolved' | 'moderation_action'

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

export function notificationHrefFor(entityType: string, entityId: string): string | null {
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
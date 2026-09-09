import 'server-only'

/**
 * Postgres error text names tables, columns and constraints, so it never
 * reaches the browser. Map the codes we raise deliberately to Mongolian
 * messages; anything unrecognised becomes a generic message and is logged.
 */
const BY_CODE: Record<string, string> = {
  '28000': 'Дахин нэвтэрнэ үү.',
  '42501': 'Танд энэ үйлдлийг хийх эрх байхгүй байна.',
  '23505': 'Энэ бичлэг аль хэдийн бүртгэгдсэн байна.',
  '23514': 'Оруулсан мэдээлэл зөвшөөрөгдөх нөхцөлд нийцэхгүй байна.',
  '54000': 'Хэт олон хүсэлт илгээлээ. Дараа дахин оролдоно уу.',
  P0002: 'Хайсан бичлэг олдсонгүй.',
}

const BY_MESSAGE: Record<string, string> = {
  ACCOUNT_NOT_ACTIVE: 'Таны хаяг түр хаагдсан байна.',
  RATE_LIMIT_BOOK_CREATE: 'Өдөрт нэмэх номын хязгаарт хүрлээ. Маргааш дахин оролдоно уу.',
  RATE_LIMIT_SWAP_REQUEST: 'Өдөрт илгээх хүсэлтийн хязгаарт хүрлээ. Маргааш дахин оролдоно уу.',
  TITLE_REQUIRED: 'Номын нэрийг оруулна уу.',

  // Swap flow
  NOT_A_PARTICIPANT: 'Энэ солилцоо танд хамаарахгүй байна.',
  NOT_YOUR_COPY: 'Зөвхөн өөрийн номоо санал болгож болно.',
  CANNOT_SWAP_WITH_SELF: 'Өөрийнхөө номтой солилцох боломжгүй.',
  SAME_COPY: 'Хоёр өөр ном сонгоно уу.',
  OFFERED_COPY_UNAVAILABLE: 'Таны санал болгож буй ном одоо боломжгүй байна.',
  REQUESTED_COPY_UNAVAILABLE: 'Энэ ном одоо солилцоонд боломжгүй байна.',
  DUPLICATE_OPEN_REQUEST: 'Та энэ ном дээр аль хэдийн хүсэлт илгээсэн байна.',
  COPY_NO_LONGER_AVAILABLE: 'Ном өөрчлөгдсөн байна. Хуудсаа шинэчилнэ үү.',
  ONLY_RESPONDER_MAY_ACCEPT: 'Зөвхөн хүсэлт хүлээн авагч зөвшөөрөх боломжтой.',
  ONLY_RESPONDER_MAY_REJECT: 'Зөвхөн хүсэлт хүлээн авагч татгалзах боломжтой.',
  ONLY_REQUESTER_MAY_CANCEL: 'Зөвхөн хүсэлт илгээгч цуцлах боломжтой.',
  OWNERSHIP_OR_STATUS_MISMATCH:
    'Солилцоон дахь ном өөрчлөгдсөн байна — өмчлөгч нь солигдсон, өөр солилцоонд орсон, ' +
    'эсвэл устсан байна. Энэ солилцоог цуцлаад дахин эхлүүлнэ үү.',
  COUNTERPARTY_ALREADY_CONFIRMED:
    'Нөгөө тал биечлэн авсныг баталгаажуулсан тул цуцлах боломжгүй. Та ч бас баталгаажуулна уу.',
  AWAITING_COUNTERPARTY_CONFIRMATION:
    'Та аль хэдийн баталгаажуулсан. Нөгөө талын баталгаажуулалтыг хүлээж байна.',
  SWAP_IS_TERMINAL: 'Энэ солилцоо аль хэдийн дууссан байна.',
  INVALID_TRANSITION: 'Энэ үйлдлийг одоогийн төлөвт хийх боломжгүй.',
}

type PgError = { code?: string; message?: string }

export function toUserMessage(error: unknown, context: string): string {
  const e = error as PgError
  console.error(`[${context}]`, e?.code ?? '', e?.message ?? error)

  if (e?.message) {
    for (const [key, msg] of Object.entries(BY_MESSAGE)) {
      if (e.message.includes(key)) return msg
    }
  }
  if (e?.code && BY_CODE[e.code]) return BY_CODE[e.code]
  return 'Үйлдэл амжилтгүй боллоо. Хуудсаа шинэчлээд дахин оролдоно уу.'
}

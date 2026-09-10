import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { ALLOWED_MIME, MAX_BYTES, MIN_BYTES } from '@/lib/storage/ports'

/**
 * An upload target for a request's single photo.
 *
 * The mirror of /api/uploads/book-image, and for the same reasons: a Route
 * Handler because the browser then uploads straight to object storage, and it
 * authenticates itself because /api is outside the proxy's matcher.
 *
 * Ownership and the one-photo rule are the database's answer, not this file's —
 * create_request_image_intent re-reads the request rather than trusting the id
 * that arrived here.
 */
const bodySchema = z.object({
  requestId: z.guid(),
  mimeType: z.enum(ALLOWED_MIME),
  byteSize: z.number().int().min(MIN_BYTES).max(MAX_BYTES),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Дахин нэвтэрнэ үү.' }, { status: 401 })

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Зургийн мэдээлэл буруу байна.' }, { status: 422 })
  }

  const storage = bookImageStorage()
  const { data, error } = await supabase.rpc('create_request_image_intent', {
    p_request_id: parsed.data.requestId,
    p_mime_type: parsed.data.mimeType,
    p_byte_size: parsed.data.byteSize,
    p_provider: storage.provider,
  })

  if (error) {
    console.error('[uploads/request-image]', error.code, error.message)
    const status = error.message.includes('NOT_YOUR_REQUEST')
      ? 403
      : error.message.includes('TOO_MANY_IMAGES')
        ? 409
        : 400
    const message =
      status === 403
        ? 'Зөвхөн өөрийн хүсэлтэд зураг нэмнэ.'
        : status === 409
          ? 'Нэг хүсэлтэд нэг зураг нэмэх боломжтой.'
          : 'Зураг нэмэх боломжгүй байна.'
    return NextResponse.json({ error: message }, { status })
  }

  const intent = Array.isArray(data) ? data[0] : data
  if (!intent) {
    return NextResponse.json({ error: 'Зураг нэмэх боломжгүй байна.' }, { status: 400 })
  }

  const thumbKey = String(intent.storage_key).replace(/\.(jpg|jpeg|png|webp)$/i, '-t.jpg')
  const [target, thumbTarget] = await Promise.all([
    storage.createUploadTarget({
      storageKey: intent.storage_key,
      mimeType: parsed.data.mimeType,
      byteSize: parsed.data.byteSize,
    }),
    storage.createUploadTarget({
      storageKey: thumbKey,
      mimeType: 'image/jpeg',
      byteSize: parsed.data.byteSize,
    }),
  ])

  return NextResponse.json({
    imageId: intent.image_id,
    storageKey: intent.storage_key,
    thumbKey,
    provider: storage.provider,
    upload: target,
    thumbUpload: thumbTarget,
  })
}

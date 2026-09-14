import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { ALLOWED_MIME, MAX_BYTES, MIN_BYTES } from '@/lib/storage/ports'

/**
 * Issues a short-lived upload target for one image.
 *
 * A Route Handler rather than a Server Action because the browser then uploads
 * straight to object storage, and because /api is excluded from the proxy
 * matcher — so this endpoint authenticates itself, as a public API must.
 */
const bodySchema = z.object({
  copyId: z.guid(),
  mimeType: z.enum(ALLOWED_MIME),
  byteSize: z.number().int().min(MIN_BYTES).max(MAX_BYTES),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Дахин нэвтэрнэ үү.' }, { status: 401 })
  }

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

  // Ownership, the per-copy limit and the key itself are all decided by the
  // database, which re-reads the copy rather than trusting anything sent here.
  const { data, error } = await supabase.rpc('create_image_upload_intent', {
    p_copy_id: parsed.data.copyId,
    p_mime_type: parsed.data.mimeType,
    p_byte_size: parsed.data.byteSize,
    p_provider: storage.provider,
  })

  if (error) {
    console.error('[uploads/book-image]', error.code, error.message)
    const status = error.message.includes('NOT_YOUR_COPY')
      ? 403
      : error.message.includes('TOO_MANY_IMAGES')
        ? 409
        : 400
    const message = status === 403
      ? 'Зөвхөн өөрийн бүртгэлдээ зураг нэмнэ.'
      : status === 409
        ? 'Нэг бүртгэлд хамгийн ихдээ 8 зураг нэмэх боломжтой.'
        : 'Зураг нэмэх боломжгүй байна.'
    return NextResponse.json({ error: message }, { status })
  }

  const intent = Array.isArray(data) ? data[0] : data
  if (!intent) {
    return NextResponse.json({ error: 'Зураг нэмэх боломжгүй байна.' }, { status: 400 })
  }

  // Two targets: the photo, and the grid-sized copy that goes with it. The
  // thumbnail's key is the photo's with `-t` before the extension — the same
  // rule publish_image checks against, so neither side can invent one.
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

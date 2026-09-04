import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { ALLOWED_MIME, MIN_BYTES } from '@/lib/storage/ports'

/**
 * Upload target for one profile picture.
 *
 * The key is derived from the caller's own id, so a signed target can never
 * address somebody else's avatar. Smaller cap than a book photo: an avatar is
 * displayed at 40px and there is no reason to store megabytes for it.
 */
// Matches what prepareImage() can hand over: the client always re-encodes to a
// JPEG under this, and a tighter cap here would reject its own output.
const AVATAR_MAX_BYTES = 5 * 1024 * 1024

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const bodySchema = z.object({
  mimeType: z.enum(ALLOWED_MIME),
  byteSize: z.number().int().min(MIN_BYTES).max(AVATAR_MAX_BYTES),
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
    return NextResponse.json(
      { error: 'Зургийн хэмжээ тохирохгүй байна. Өөр зураг сонгоно уу.' },
      { status: 422 }
    )
  }

  const storage = bookImageStorage()
  const storageKey = `avatars/${user.id}/${randomUUID()}.${EXTENSION[parsed.data.mimeType]}`
  const target = await storage.createUploadTarget({
    storageKey,
    mimeType: parsed.data.mimeType,
    byteSize: parsed.data.byteSize,
  })

  return NextResponse.json({ storageKey, upload: target })
}

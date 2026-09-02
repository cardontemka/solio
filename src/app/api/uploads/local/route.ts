import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { LocalDevelopmentStorage } from '@/lib/storage/local'
import { MAX_BYTES, MIN_BYTES } from '@/lib/storage/ports'

/**
 * ⚠️ DEVELOPMENT ONLY.
 *
 * Stands in for R2's presigned PUT so the whole upload flow can be exercised
 * without cloud credentials. It accepts bytes only for a `pending` image row
 * that belongs to the caller — the same authorisation R2's signed URL encodes.
 */
export async function PUT(request: NextRequest) {
  const storage = bookImageStorage()
  if (!(storage instanceof LocalDevelopmentStorage)) {
    return NextResponse.json({ error: 'Not available.' }, { status: 404 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Дахин нэвтэрнэ үү.' }, { status: 401 })

  const key = request.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key дутуу.' }, { status: 400 })

  // RLS limits this read to images on copies the caller owns.
  const { data: image } = await supabase
    .from('book_images')
    .select('id, status')
    .eq('storage_key', key)
    .eq('status', 'pending')
    .maybeSingle()

  if (!image) return NextResponse.json({ error: 'Зөвшөөрөлгүй.' }, { status: 403 })

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength < MIN_BYTES || bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Файлын хэмжээ зөвшөөрөгдөх хязгаараас гадуур.' }, { status: 413 })
  }

  await storage.write(key, bytes)
  return NextResponse.json({ ok: true })
}

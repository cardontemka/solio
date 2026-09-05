import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { ALLOWED_MIME, MAX_BYTES, MIN_BYTES } from '@/lib/storage/ports'
import { sniffMime } from '@/lib/storage/verify'

/**
 * Uploads bytes through the server instead of straight from the browser.
 *
 * The direct-to-storage PUT is faster and keeps files out of the application,
 * but it only works when the page's origin is in the bucket's CORS list — which
 * silently excludes every preview deployment, every new domain, and a phone
 * testing against a laptop over the LAN. Photos are re-encoded to about 100KB
 * before they leave the browser, so routing them through here costs little and
 * works from anywhere. The client uses it when the direct PUT fails.
 *
 * The key is never taken on trust: it has to name a pending row this caller can
 * see, or their own avatar prefix. The bytes are sniffed here too, so this path
 * cannot be used to put arbitrary content in the bucket.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Дахин нэвтэрнэ үү.' }, { status: 401 })

  const key = request.nextUrl.searchParams.get('key') ?? ''
  const mimeType = request.headers.get('content-type') ?? ''

  if (!(ALLOWED_MIME as readonly string[]).includes(mimeType)) {
    return NextResponse.json({ error: 'Зөвхөн JPEG, PNG, WebP зураг байршуулна.' }, { status: 415 })
  }
  if (key.includes('..') || key.startsWith('/')) {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 })
  }

  // Who is allowed to write this key?
  if (key.startsWith('avatars/')) {
    if (!key.startsWith(`avatars/${user.id}/`)) {
      return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 403 })
    }
  } else if (key.startsWith('copies/')) {
    // RLS scopes this select, so a key belonging to somebody else's listing
    // simply does not come back.
    const { data: row } = await supabase
      .from('book_images')
      .select('id, status, uploaded_by')
      .eq('storage_key', key)
      .maybeSingle()
    if (!row || row.status !== 'pending' || row.uploaded_by !== user.id) {
      return NextResponse.json({ error: 'Зураг олдсонгүй.' }, { status: 403 })
    }
  } else {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 })
  }

  const buffer = new Uint8Array(await request.arrayBuffer())
  if (buffer.byteLength < MIN_BYTES || buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Зургийн хэмжээ тохирохгүй байна.' }, { status: 413 })
  }
  if (sniffMime(buffer) === null) {
    return NextResponse.json({ error: 'Файл зураг биш байна.' }, { status: 415 })
  }

  try {
    await bookImageStorage().put(key, buffer, mimeType)
  } catch (e) {
    console.error('[uploads/bytes]', (e as Error).message)
    return NextResponse.json({ error: 'Зургийг хадгалж чадсангүй.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}

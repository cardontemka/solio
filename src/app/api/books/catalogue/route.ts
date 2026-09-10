import { NextResponse, type NextRequest } from 'next/server'
import { suggestCatalogue } from '@/features/books/queries'
import { ITEM_KIND, type ItemKind } from '@/types/domain'

/**
 * "Энэ ном биш биз?" for the add form — records included, matched within their
 * own kind so an album title never turns up a novel.
 *
 * A route handler rather than a Server Action for the same reason the header's
 * type-ahead is one: it fires on keystrokes, so it should be cancellable by the
 * browser and cost nothing to repeat.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? ''
  const raw = request.nextUrl.searchParams.get('kind')
  const kind = (ITEM_KIND as readonly string[]).includes(raw ?? '') ? (raw as ItemKind) : 'book'
  if (q.trim().length < 2) return NextResponse.json({ items: [] })

  try {
    return NextResponse.json({ items: await suggestCatalogue(q, kind) })
  } catch (e) {
    console.error('[books/catalogue]', (e as Error).message)
    // A failed lookup must never block typing — an empty list just means no
    // dropdown, and the reader describes the book themselves.
    return NextResponse.json({ items: [] })
  }
}

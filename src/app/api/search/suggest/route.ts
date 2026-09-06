import { NextResponse, type NextRequest } from 'next/server'
import { suggestListings } from '@/features/books/queries'

/**
 * Type-ahead for the header search.
 *
 * A route handler rather than a Server Action because it is a read that fires
 * on keystrokes: it should be cancellable by the browser and cost nothing to
 * repeat. RLS still applies — the query runs as whoever is asking.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? ''
  if (q.trim().length < 2) return NextResponse.json({ items: [] })

  try {
    const items = await suggestListings(q)
    return NextResponse.json({ items })
  } catch (e) {
    console.error('[search/suggest]', (e as Error).message)
    // A failed suggestion must never block typing; an empty list just means no
    // dropdown.
    return NextResponse.json({ items: [] })
  }
}

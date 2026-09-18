import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Records that somebody clicked a category, or opened a listing.
 *
 * A route handler rather than a Server Action because it is fire-and-forget from
 * a link that is already navigating: the browser sends it with keepalive and
 * never waits for the answer. A Server Action would re-render the tree for a row
 * nothing on the page displays.
 *
 * It records nothing for a signed-out visitor — record_interest() returns
 * quietly rather than failing, so a reader who is not signed in simply leaves no
 * trace — and it answers 204 either way, so the browser cannot tell from the
 * response whether anything was stored.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      kind?: unknown
      category?: unknown
      copyId?: unknown
      query?: unknown
    }
    const kinds = ['category_click', 'item_view', 'search']
    const kind = typeof body.kind === 'string' && kinds.includes(body.kind) ? body.kind : null
    if (!kind) return new NextResponse(null, { status: 204 })

    const supabase = await createClient()
    await supabase.rpc('record_interest', {
      p_kind: kind,
      p_category: typeof body.category === 'string' ? body.category : null,
      p_copy_id: typeof body.copyId === 'string' ? body.copyId : null,
      // Capped here as well as in the database: no reason to put a pasted page
      // on the wire to have it truncated at the other end.
      p_query: typeof body.query === 'string' ? body.query.slice(0, 200) : null,
    })
  } catch {
    // Nothing on any page depends on this having worked.
  }
  return new NextResponse(null, { status: 204 })
}

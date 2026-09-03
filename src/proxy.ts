import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Next.js 16 renamed the `middleware` convention to `proxy`
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/middleware.md).
 * Supabase's published guides still say middleware.ts — this is the same thing.
 *
 * Two jobs only:
 *   1. refresh the Supabase session so rotated cookies get written
 *   2. bounce signed-out visitors away from private routes
 *
 * This is NOT an authorisation boundary. It runs on prefetches, does no
 * database reads, and /api is excluded from the matcher entirely. Every real
 * check happens again in the Server Action or the RPC.
 */

const PRIVATE_PREFIXES = ['/my-books', '/swaps', '/notifications', '/settings', '/dashboard', '/books/new']
const AUTH_ONLY_PREFIXES = ['/login', '/register']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser(), not getSession(): getSession only decodes the cookie, which the
  // client controls. getUser revalidates the token with the auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  if (!user && PRIVATE_PREFIXES.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  if (user && AUTH_ONLY_PREFIXES.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/my-books'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

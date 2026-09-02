import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/validation/env'

/**
 * Where every out-of-band auth flow lands: the email confirmation link, the
 * password reset link, and the OAuth providers all redirect here with a `code`
 * that has to be exchanged for a session.
 *
 * Without this route the confirmation link goes nowhere and the account stays
 * unconfirmed, which looks to the user like "I registered but cannot sign in".
 *
 * A Route Handler, not a Server Action: a third party redirects the browser
 * here, and an action cannot receive that.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  // Behind a proxy the request origin is the internal host, so the canonical
  // site URL wins when it is configured.
  const base = publicEnv.siteUrl.replace(/\/+$/, '') || request.nextUrl.origin

  const code = searchParams.get('code')
  const errorDescription = searchParams.get('error_description')

  // Only ever redirect within this site: an open redirect here would hand an
  // attacker a session-carrying link on our own domain.
  const requested = searchParams.get('next') ?? '/my-books'
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/my-books'

  if (errorDescription) {
    console.error('[auth/callback]', errorDescription)
    return NextResponse.redirect(`${base}/login?error=provider`)
  }

  if (!code) {
    return NextResponse.redirect(`${base}/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback]', error.message)
    return NextResponse.redirect(`${base}/login?error=exchange`)
  }

  return NextResponse.redirect(`${base}${next}`)
}

import { type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { OAUTH_NEXT_COOKIE, safeNext } from '@/features/users/oauthNext'

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

/**
 * Redirects with a **relative** Location, deliberately.
 *
 * The session cookies this route sets belong to the origin the request arrived
 * on. Sending the reader to a configured absolute origin instead — which is
 * what this used to do — hands them to a host where those cookies do not
 * exist, so a successful exchange still arrives signed out. That is invisible
 * in production, where the two agree, and breaks every preview deployment and
 * every dev server on a port other than 3000.
 *
 * A relative Location is also the one form that cannot become an open
 * redirect: the browser resolves it against the origin it is already on, so a
 * forged Host header has nothing to aim at.
 */
function back(path: string) {
  return new Response(null, { status: 303, headers: { Location: path } })
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  // Where to land afterwards. The cookie is the normal carrier — see
  // oauthNext.ts for why it is not a query parameter — and the parameter is
  // still read for the flows that can safely use one, such as an email link
  // this site builds itself.
  const store = await cookies()
  const remembered = store.get(OAUTH_NEXT_COOKIE)?.value
  const next = safeNext(
    searchParams.get('next') ?? (remembered ? decodeURIComponent(remembered) : null)
  )
  // Spent either way: this round trip is over, and a stale destination would
  // steer the next one. Deleted through the same store the session cookies are
  // written to, so Next merges one set of Set-Cookie headers rather than two
  // that overwrite each other.
  if (remembered) store.set(OAUTH_NEXT_COOKIE, '', { maxAge: 0, path: '/' })

  const code = searchParams.get('code')
  const errorDescription = searchParams.get('error_description')

  if (errorDescription) {
    console.error('[auth/callback] provider said:', errorDescription)
    return back('/login?error=provider')
  }

  // GoTrue reports a dead link in the URL *fragment* — `#error=access_denied&
  // error_code=otp_expired` — which never reaches a server. Bounce to the login
  // page and let it read the fragment the browser still carries: saying "the
  // link is incomplete" to somebody whose link had simply expired sent them
  // looking for a truncated URL that was never the problem.
  if (!code) {
    return back(`/login?error=missing_code&next=${encodeURIComponent(next)}`)
  }

  const supabase = await createClient()

  // Which PKCE flow this code belongs to. Since @supabase/auth-js started
  // supporting concurrent flows, the verifier lives in a per-flow cookie and
  // the fixed legacy cookie only mirrors the most recent one. Without this
  // parameter a second attempt — another tab, or simply clicking the button
  // again because the first felt stuck — overwrites that mirror, and the code
  // that comes back can never be exchanged. Passing it makes each flow read
  // its own verifier.
  const flowId = searchParams.get('sb_flow_id')

  const { error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined
  )

  if (error) {
    // A code is single-use, and this route can be asked for twice — a retried
    // request, a browser that prefetches the redirect. If the first attempt
    // succeeded there is a session already and nothing is wrong.
    const { data: claims } = await supabase.auth.getClaims()
    if (claims?.claims?.sub) {
      return back(next)
    }

    console.error(
      '[auth/callback]',
      error.name,
      error.code ?? '',
      error.message,
      `host=${request.headers.get('host') ?? '?'}`,
      `flow=${flowId ? 'yes' : 'no'}`
    )

    // The verifier is a cookie on the origin the sign-in *started* from. Not
    // finding it almost always means the flow started somewhere else and the
    // provider sent the code here instead — the symptom of a redirect URL that
    // is not on the project's allow list. Worth its own message: "the link
    // expired" sends people to retry the very thing that cannot work.
    if (error.name === 'AuthPKCECodeVerifierMissingError') {
      return back('/login?error=other_origin')
    }
    return back('/login?error=exchange')
  }

  return back(next)
}

/**
 * Where to go after an OAuth round trip, carried in a cookie rather than in the
 * redirect URL.
 *
 * It used to travel as `?next=/my-books` on the URL handed to the provider, and
 * that is a trap: an auth provider validates the redirect it is given against
 * the project's allow list, and an entry written out in full — the shape the
 * Supabase dashboard produces when you paste a URL rather than a pattern —
 * matches the path and nothing else. Add one query parameter and the match
 * fails silently; the provider then falls back to the project's Site URL, so
 * the code lands on a different origin from the one holding the PKCE verifier
 * and the sign-in can never complete. Measured against this project: signing in
 * from localhost sent every code to the production deployment.
 *
 * A cookie has none of that coupling. The URL the provider sees is always the
 * bare callback path, which matches the strictest allow-list entry there is,
 * and the destination rides along in the browser that is going there anyway.
 *
 * Lax rather than Strict: the return trip is a cross-site redirect from the
 * provider, and a Strict cookie would not be sent on it — which is the whole
 * journey this exists for.
 */
export const OAUTH_NEXT_COOKIE = 'solio-oauth-next'

/** Ten minutes: long enough to pick an account, short enough to be forgotten. */
const MAX_AGE = 600

/** Only ever a path inside this site — never `//evil.example` or a full URL. */
export function safeNext(value: string | undefined | null, fallback = '/my-books') {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : fallback
}

/** Called in the browser, immediately before handing over to the provider. */
export function rememberNext(next: string) {
  const path = safeNext(next)
  document.cookie =
    `${OAUTH_NEXT_COOKIE}=${encodeURIComponent(path)}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax` +
    (window.location.protocol === 'https:' ? '; Secure' : '')
}

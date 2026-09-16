/**
 * Environment access. This is the ONLY module that reads process.env, so a
 * missing variable fails here with a name, not as an obscure runtime error
 * three layers deep.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing environment variable: ${name}\n` +
        `Copy .env.example to .env.local and fill it in — see docs/setup.md.`
    )
  }
  return value
}

/**
 * Where this deployment lives — canonical URLs, auth redirects, the sitemap.
 *
 * Never throws, and never returns something `new URL()` will reject. It used
 * to be `process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'`, which
 * looks safe and is not: `??` only catches undefined, and a variable *defined
 * as empty* in a hosting dashboard — or inlined as `""` by the bundler when it
 * is declared for one environment and not another — sails straight through.
 * That took the whole production build down at `metadataBase: new URL('')`,
 * from a page that has nothing to do with any of this.
 *
 * On Vercel the deployment's own domain is a far better fallback than
 * localhost: a sitemap or an OG tag pointing at 127.0.0.1 is worse than useless
 * in public, while the vercel.app URL at least resolves.
 */
function resolveSiteUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
  ]
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (!value) continue
    // A bare hostname is what people paste; make it a URL before testing it.
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`
    try {
      return new URL(withScheme).origin
    } catch {
      // Try the next one rather than taking the build down over a typo.
    }
  }
  return 'http://localhost:3000'
}

/** Safe in the browser: only NEXT_PUBLIC_ values. */
export const publicEnv = {
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ),
  /** Always an origin with no trailing slash — safe to concatenate. */
  siteUrl: resolveSiteUrl(),
}

/** Server-only. Never import from a Client Component. */
export function serviceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY)
}

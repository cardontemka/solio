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

/** Safe in the browser: only NEXT_PUBLIC_ values. */
export const publicEnv = {
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ),
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
}

/** Server-only. Never import from a Client Component. */
export function serviceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY)
}

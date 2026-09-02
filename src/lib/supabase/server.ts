import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { publicEnv } from '@/lib/validation/env'

/**
 * Server client, scoped to the caller's session. Every query it runs is
 * subject to RLS as that user — which is the point.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Server Components cannot set cookies. Harmless: src/proxy.ts
          // refreshes the session on every request, so the rotated cookie is
          // written there instead.
        }
      },
    },
  })
}

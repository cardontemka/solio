import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { publicEnv } from '@/lib/validation/env'
import { serviceRoleKey } from '@/lib/validation/env'

/**
 * ⚠️ Bypasses Row Level Security completely.
 *
 * Only for operations that genuinely cannot run as the user — e.g. reading
 * another account's email for an admin support flow, which must also write an
 * audit_logs row. Never expose it to a Client Component; the `server-only`
 * import above turns any such import into a build error.
 */
export function createAdminClient() {
  return createClient(publicEnv.supabaseUrl, serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

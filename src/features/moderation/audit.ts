import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Records a refused privileged action.
 *
 * This cannot live in the database function that refuses it: PostgreSQL has no
 * autonomous transactions, so the INSERT would be rolled back by the RAISE
 * that follows it. Writing it here, after the RPC has already failed, is the
 * only way the attempt survives.
 *
 * A log that records only successes cannot answer "did anyone try?", which is
 * the first question in any incident.
 */
export async function auditDenied(input: {
  actorId: string
  action: string
  entityType: string
  entityId: string
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('audit_logs').insert({
      actor_id: input.actorId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      outcome: 'denied',
    })
  } catch (error) {
    // Never let audit failure mask the refusal itself.
    console.error('[auditDenied] could not record denial', error)
  }
}

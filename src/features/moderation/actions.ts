'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { toUserMessage } from '@/lib/db/errors'
import { flushPendingPush } from '@/lib/push/send'
import { auditDenied } from './audit'

export type ModState = { ok: true } | { ok: false; message?: string }

const idSchema = z.guid()

/**
 * Every action re-authenticates and lets the database decide the role — the
 * admin layout's gate controls what is *rendered*, not what is *permitted*.
 *
 * When the database refuses, the attempt is recorded here, because a RAISE
 * inside the function would roll back any audit row written alongside it.
 */
async function callModeration(
  rpc: string,
  args: Record<string, unknown>,
  denial: { action: string; entityType: string; entityId: string }
): Promise<ModState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const { error } = await supabase.rpc(rpc, args)
  if (!error) return { ok: true }

  if (error.message.includes('STAFF_ONLY') || error.message.includes('ADMIN_ONLY')) {
    await auditDenied({ actorId: user.id, ...denial })
    return { ok: false, message: 'Танд энэ үйлдлийг хийх эрх байхгүй байна.' }
  }
  if (error.message.includes('CANNOT_MODERATE_ADMIN')) {
    return { ok: false, message: 'Админ хэрэглэгчид модерац хийх боломжгүй.' }
  }
  if (error.message.includes('CANNOT_MODERATE_SELF')) {
    return { ok: false, message: 'Өөрийгөө модерацлах боломжгүй.' }
  }
  if (error.message.includes('CANNOT_CHANGE_OWN_ROLE')) {
    return { ok: false, message: 'Өөрийн эрхээ өөрчлөх боломжгүй.' }
  }
  return { ok: false, message: toUserMessage(error, rpc) }
}

export async function moderateEntityAction(
  entityType: 'book' | 'book_copy' | 'book_image' | 'comment' | 'request',
  entityId: string,
  status: 'active' | 'hidden' | 'removed',
  reason?: string
): Promise<ModState> {
  if (!idSchema.safeParse(entityId).success) return { ok: false, message: 'Буруу хүсэлт.' }

  const result = await callModeration(
    'moderate_entity',
    {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_status: status,
      p_reason: reason?.slice(0, 500) ?? null,
    },
    { action: `moderate.${entityType}`, entityType, entityId }
  )

  revalidatePath('/admin/content')
  revalidatePath('/')
  return result
}

/**
 * Deletes content outright — rows gone, photos gone from the bucket.
 *
 * The counterpart to moderateEntityAction's 'hidden', which is reversible and
 * leaves everything where it was. This one is not reversible, so the database
 * restricts it to admins; a moderator's judgement call is the hide.
 *
 * The RPC returns the storage keys it orphaned rather than deleting the objects
 * itself — the database has no reach into R2. A failed object delete is logged
 * and swallowed: the rows are already gone, and refusing to report success over
 * a leftover file would be a lie about what happened.
 */
export async function purgeEntityAction(
  entityType: 'book' | 'book_copy' | 'comment' | 'request',
  entityId: string,
  reason?: string
): Promise<ModState> {
  if (!idSchema.safeParse(entityId).success) return { ok: false, message: 'Буруу хүсэлт.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const { data, error } = await supabase.rpc('purge_content', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_reason: reason?.slice(0, 500) ?? null,
  })

  if (error) {
    if (error.message.includes('ADMIN_ONLY')) {
      await auditDenied({
        actorId: user.id,
        action: `purge.${entityType}`,
        entityType,
        entityId,
      })
      return { ok: false, message: 'Бүрмөсөн устгах эрх зөвхөн админд байна.' }
    }
    if (error.message.includes('LISTING_IN_ACTIVE_SWAP')) {
      return {
        ok: false,
        message: 'Энэ ном идэвхтэй солилцоонд байна. Эхлээд солилцоог дуусгах эсвэл цуцлана уу.',
      }
    }
    if (error.message.includes('ENTITY_NOT_FOUND')) {
      return { ok: false, message: 'Аль хэдийн устсан байна.' }
    }
    return { ok: false, message: toUserMessage(error, 'purgeContent') }
  }

  const keys = ((data ?? []) as { storage_key: string }[]).map((r) => r.storage_key)
  if (keys.length > 0) {
    const storage = bookImageStorage()
    await Promise.all(
      keys.map((key) =>
        storage.delete(key).catch((e) => {
          console.error('[purgeEntityAction] orphaned object', key, (e as Error).message)
        })
      )
    )
  }

  after(flushPendingPush)

  revalidatePath('/admin/reports')
  revalidatePath('/admin/content')
  revalidatePath('/admin')
  revalidatePath('/')
  return { ok: true }
}

export async function moderateProfileAction(
  userId: string,
  status: 'active' | 'suspended' | 'removed',
  reason?: string
): Promise<ModState> {
  if (!idSchema.safeParse(userId).success) return { ok: false, message: 'Буруу хүсэлт.' }

  const result = await callModeration(
    'moderate_profile',
    { p_user_id: userId, p_status: status, p_reason: reason?.slice(0, 500) ?? null },
    { action: 'moderate.profile', entityType: 'profile', entityId: userId }
  )

  after(flushPendingPush)

  revalidatePath('/admin/users')
  return result
}

export async function resolveReportAction(
  reportId: string,
  status: 'reviewing' | 'resolved' | 'dismissed',
  note?: string
): Promise<ModState> {
  if (!idSchema.safeParse(reportId).success) return { ok: false, message: 'Буруу хүсэлт.' }

  const result = await callModeration(
    'resolve_report',
    { p_report_id: reportId, p_status: status, p_note: note?.slice(0, 2000) ?? null },
    { action: 'report.resolve', entityType: 'report', entityId: reportId }
  )

  after(flushPendingPush)

  revalidatePath('/admin/reports')
  revalidatePath('/admin')
  return result
}

export async function setRoleAction(
  userId: string,
  role: 'moderator' | 'admin',
  grant: boolean
): Promise<ModState> {
  if (!idSchema.safeParse(userId).success) return { ok: false, message: 'Буруу хүсэлт.' }

  const result = await callModeration(
    'admin_set_role',
    { p_user_id: userId, p_role: role, p_grant: grant },
    { action: grant ? 'role.granted' : 'role.revoked', entityType: 'profile', entityId: userId }
  )

  after(flushPendingPush)

  revalidatePath('/admin/users')
  return result
}

/** Filing a report is an ordinary user action, not a privileged one. */
const reportSchema = z.object({
  entityType: z.enum(['book', 'book_copy', 'comment', 'request', 'profile', 'swap']),
  entityId: z.guid(),
  reason: z.enum(['spam', 'inappropriate', 'counterfeit', 'wrong_metadata', 'harassment', 'other']),
  detail: z.string().trim().max(2000).optional(),
})

export async function createReportAction(
  _prev: ModState,
  formData: FormData
): Promise<ModState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = reportSchema.safeParse({
    entityType: formData.get('entityType'),
    entityId: formData.get('entityId'),
    reason: formData.get('reason'),
    detail: formData.get('detail') ?? '',
  })
  if (!parsed.success) return { ok: false, message: 'Мэдээллээ шалгана уу.' }

  const { error } = await supabase.from('reports').insert({
    reporter_id: user.id,
    entity_type: parsed.data.entityType,
    entity_id: parsed.data.entityId,
    reason: parsed.data.reason,
    detail: parsed.data.detail || null,
  })

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Та энэ зүйл дээр аль хэдийн гомдол гаргасан байна.' }
    }
    if (error.code === '42501') {
      return { ok: false, message: 'Гомдлын хязгаарт хүрсэн эсвэл хаяг тань идэвхгүй байна.' }
    }
    return { ok: false, message: toUserMessage(error, 'createReport') }
  }

  // The insert trigger has already written a notification for every moderator;
  // this is what turns those rows into a push while the request is still warm.
  after(flushPendingPush)

  return { ok: true }
}

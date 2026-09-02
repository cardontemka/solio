'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { toUserMessage } from '@/lib/db/errors'
import { auditDenied } from './audit'
import { emailNotification } from '@/lib/email/notifications'

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

/** Best-effort email to the reporter of a resolved report. */
async function emailReportReporter(reportId: string) {
  try {
    const supabase = await createClient()
    const { data } = await supabase.from('reports').select('reporter_id').eq('id', reportId).single()
    if (data?.reporter_id) {
      await emailNotification({
        userId: data.reporter_id,
        type: 'report_resolved',
        entityType: 'report',
        entityId: reportId,
      })
    }
  } catch (e) {
    console.error('[resolveReport] email failed', e)
  }
}

export async function moderateEntityAction(
  entityType: 'book' | 'book_copy' | 'book_image',
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

  if (result.ok) {
    await emailNotification({ userId, type: 'moderation_action', entityType: 'profile', entityId: userId })
  }

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

  if (result.ok && status !== 'reviewing') {
    await emailReportReporter(reportId)
  }

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

  if (result.ok) {
    await emailNotification({ userId, type: 'moderation_action', entityType: 'profile', entityId: userId })
  }

  revalidatePath('/admin/users')
  return result
}

/** Filing a report is an ordinary user action, not a privileged one. */
const reportSchema = z.object({
  entityType: z.enum(['book', 'book_copy', 'review', 'profile', 'swap']),
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
      return { ok: false, message: 'Гомдлын хязгаарт хүрсэн эсвэл данс идэвхгүй байна.' }
    }
    return { ok: false, message: toUserMessage(error, 'createReport') }
  }

  return { ok: true }
}

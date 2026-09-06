import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/auth/dal'

/**
 * Read side of the admin panel. Staff visibility comes from RLS policies that
 * call private.is_staff() — these queries add no role filter of their own, so
 * a non-staff caller simply sees nothing rather than being trusted not to look.
 */

export type StaffRole = 'user' | 'moderator' | 'admin'

export async function getStaffRoles(): Promise<StaffRole[]> {
  const user = await getSessionUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id)
  return ((data ?? []) as { role: StaffRole }[]).map((r) => r.role)
}

export async function isStaff(): Promise<boolean> {
  const roles = await getStaffRoles()
  return roles.includes('moderator') || roles.includes('admin')
}

export async function isAdmin(): Promise<boolean> {
  return (await getStaffRoles()).includes('admin')
}

export type ReportView = {
  id: string
  entityType: string
  entityId: string
  reason: string
  detail: string | null
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed'
  createdAt: string
  reporterName: string
  resolutionNote: string | null
  targetLabel: string | null
  /** Where the reported thing actually lives, so a moderator can look first. */
  targetHref: string | null
}

const REASON_LABEL: Record<string, string> = {
  spam: 'Спам',
  inappropriate: 'Зохисгүй агуулга',
  counterfeit: 'Хуурамч ном',
  wrong_metadata: 'Буруу мэдээлэл',
  harassment: 'Дарамт',
  other: 'Бусад',
}

export const REPORT_REASON_LABEL = REASON_LABEL

export async function getReports(): Promise<ReportView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reports')
    .select(
      `id, entity_type, entity_id, reason, detail, status, created_at, resolution_note,
       reporter:profiles!reports_reporter_id_fkey ( display_name )`
    )
    .order('created_at', { ascending: false })
  if (error) throw error

  type Row = {
    id: string
    entity_type: string
    entity_id: string
    reason: string
    detail: string | null
    status: ReportView['status']
    created_at: string
    resolution_note: string | null
    reporter: { display_name: string } | { display_name: string }[] | null
  }
  const rows = (data ?? []) as unknown as Row[]

  // Resolve a label and a link for whatever each report points at.
  //
  // Without this a moderator sees a type and eight characters of a UUID, and
  // has to decide whether to hide something they cannot look at. Every kind is
  // resolved here so the table can be acted on rather than guessed at.
  const idsOf = (type: string) =>
    rows.filter((r) => r.entity_type === type).map((r) => r.entity_id)

  const label = new Map<string, string>()
  const href = new Map<string, string>()

  const bookIds = idsOf('book')
  if (bookIds.length > 0) {
    const { data: books } = await supabase.from('books').select('id, title').in('id', bookIds)
    for (const b of (books ?? []) as { id: string; title: string }[]) {
      label.set(b.id, b.title)
      // /books/[copyId] resolves a books id to one of its listings.
      href.set(b.id, `/books/${b.id}`)
    }
  }

  const copyIds = idsOf('book_copy')
  if (copyIds.length > 0) {
    const { data: copies } = await supabase
      .from('book_copies')
      .select('id, books ( title )')
      .in('id', copyIds)
    type C = { id: string; books: { title: string } | { title: string }[] | null }
    for (const c of (copies ?? []) as unknown as C[]) {
      const book = Array.isArray(c.books) ? c.books[0] : c.books
      label.set(c.id, book?.title ?? 'Ном')
      href.set(c.id, `/books/${c.id}`)
    }
  }

  const requestIds = idsOf('request')
  if (requestIds.length > 0) {
    const { data: reqs } = await supabase
      .from('book_requests')
      .select('id, title')
      .in('id', requestIds)
    for (const q of (reqs ?? []) as { id: string; title: string }[]) {
      label.set(q.id, q.title)
      href.set(q.id, `/requests/${q.id}`)
    }
  }

  // A comment has no page of its own; it is linked in the thread it lives in,
  // anchored so the moderator lands on the comment itself.
  const commentIds = idsOf('comment')
  if (commentIds.length > 0) {
    const { data: comments } = await supabase
      .from('comments')
      .select('id, body, book_copy_id, request_id')
      .in('id', commentIds)
    type M = { id: string; body: string; book_copy_id: string | null; request_id: string | null }
    for (const m of (comments ?? []) as M[]) {
      label.set(m.id, m.body.slice(0, 60))
      const parent = m.book_copy_id
        ? `/books/${m.book_copy_id}`
        : m.request_id
          ? `/requests/${m.request_id}`
          : null
      if (parent) href.set(m.id, `${parent}#comment-${m.id}`)
    }
  }

  const profileIds = idsOf('profile')
  if (profileIds.length > 0) {
    const { data: people } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', profileIds)
    type P = { id: string; username: string; display_name: string }
    for (const p of (people ?? []) as P[]) {
      label.set(p.id, p.display_name)
      href.set(p.id, `/u/${p.username}`)
    }
  }

  for (const id of idsOf('swap')) href.set(id, '/swaps')

  return rows.map((r) => {
    const reporter = Array.isArray(r.reporter) ? r.reporter[0] : r.reporter
    return {
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      reason: REASON_LABEL[r.reason] ?? r.reason,
      detail: r.detail,
      status: r.status,
      createdAt: r.created_at.slice(0, 10),
      reporterName: reporter?.display_name ?? 'Тодорхойгүй',
      resolutionNote: r.resolution_note,
      targetLabel: label.get(r.entity_id) ?? null,
      targetHref: href.get(r.entity_id) ?? null,
    }
  })
}

export type UserRow = {
  id: string
  username: string
  displayName: string
  city: string | null
  accountStatus: 'active' | 'suspended' | 'removed'
  roles: StaffRole[]
  copyCount: number
  joinedAt: string
}

export async function getUsers(): Promise<UserRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    // Both user_roles and book_copies carry TWO foreign keys to profiles
    // (user_id/granted_by and owner_id/custodian_id), so the relationship has
    // to be named — otherwise PostgREST refuses the embed with PGRST201.
    .select(
      `id, username, display_name, city, account_status, created_at,
       user_roles!user_roles_user_id_fkey ( role ),
       book_copies!book_copies_owner_id_fkey ( id )`
    )
    .order('created_at', { ascending: false })
  if (error) throw error

  type Row = {
    id: string
    username: string
    display_name: string
    city: string | null
    account_status: UserRow['accountStatus']
    created_at: string
    user_roles: { role: StaffRole }[]
    book_copies: { id: string }[]
  }
  return ((data ?? []) as unknown as Row[]).map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    city: p.city,
    accountStatus: p.account_status,
    roles: (p.user_roles ?? []).map((r) => r.role),
    copyCount: (p.book_copies ?? []).length,
    joinedAt: p.created_at.slice(0, 10),
  }))
}

export type ContentRow = {
  id: string
  title: string
  author: string | null
  moderationStatus: 'active' | 'hidden' | 'removed'
  copyCount: number
  createdAt: string
}

export async function getContent(): Promise<ContentRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('books')
    .select('id, title, author, moderation_status, created_at, book_copies ( id )')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error

  type Row = {
    id: string
    title: string
    author: string | null
    moderation_status: ContentRow['moderationStatus']
    created_at: string
    book_copies: { id: string }[]
  }
  return ((data ?? []) as unknown as Row[]).map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    moderationStatus: b.moderation_status,
    copyCount: (b.book_copies ?? []).length,
    createdAt: b.created_at.slice(0, 10),
  }))
}

export type AuditRow = {
  id: number
  action: string
  entityType: string
  entityId: string
  outcome: 'success' | 'denied'
  actorName: string | null
  actorRole: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export async function getAuditLog(limit = 100): Promise<AuditRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('audit_logs')
    .select(
      `id, action, entity_type, entity_id, outcome, actor_role, payload, created_at,
       actor:profiles!audit_logs_actor_id_fkey ( display_name )`
    )
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  type Row = Omit<AuditRow, 'actorName' | 'entityType' | 'entityId' | 'actorRole' | 'createdAt'> & {
    entity_type: string
    entity_id: string
    actor_role: string | null
    created_at: string
    actor: { display_name: string } | { display_name: string }[] | null
  }
  return ((data ?? []) as unknown as Row[]).map((a) => {
    const actor = Array.isArray(a.actor) ? a.actor[0] : a.actor
    return {
      id: a.id,
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      outcome: a.outcome,
      actorName: actor?.display_name ?? null,
      actorRole: a.actor_role,
      payload: a.payload ?? {},
      createdAt: a.created_at.replace('T', ' ').slice(0, 16),
    }
  })
}

export async function getAdminCounts() {
  const supabase = await createClient()
  const head = { count: 'exact' as const, head: true }

  const [reports, users, books, swaps] = await Promise.all([
    supabase.from('reports').select('id', head).in('status', ['open', 'reviewing']),
    supabase.from('profiles').select('id', head),
    supabase.from('books').select('id', head),
    supabase.from('swaps').select('id', head),
  ])

  return {
    openReports: reports.count ?? 0,
    users: users.count ?? 0,
    books: books.count ?? 0,
    swaps: swaps.count ?? 0,
  }
}

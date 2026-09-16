import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { getListingsByIds, type Listing } from '@/features/books/queries'
import type { StoragePoint, StoragePointKind } from '@/types/domain'

/**
 * Read side of storage points — the cafés, libraries and shops that hold other
 * people's books.
 *
 * A point is a public place, so everything here is readable signed out: the
 * whole purpose of the row is that somebody can find the door. Its RLS policy
 * hides it exactly when the profile behind it is hidden, so a suspended venue
 * disappears from the picker and from every listing that named it without this
 * file knowing anything about moderation.
 */

type Row = {
  id: string
  profile_id?: string
  name: string
  kind: string
  city: string
  district: string
  address: string
  landmark?: string | null
  phone: string
  hours: string
  capacity?: number | null
  website?: string | null
  description?: string | null
  cover_key?: string | null
  username?: string
  profiles?: { username: string } | { username: string }[] | null
}

function toPoint(row: Row, username: string): StoragePoint {
  return {
    id: row.id,
    username,
    name: row.name,
    kind: row.kind as StoragePointKind,
    city: row.city,
    district: row.district,
    address: row.address,
    landmark: row.landmark ?? null,
    phone: row.phone,
    hours: row.hours,
    capacity: row.capacity ?? null,
    website: row.website ?? null,
    description: row.description ?? null,
    coverUrl: row.cover_key ? bookImageStorage().publicUrl(row.cover_key) : null,
  }
}

export type StoragePointOption = {
  id: string
  username: string
  name: string
  kind: StoragePointKind
  city: string
  district: string
  address: string
  landmark: string | null
  phone: string
  hours: string
  coverUrl: string | null
}

/**
 * Every point that is open for business, for the picker on a listing.
 *
 * Through an RPC rather than a select, because the picker needs the username
 * that the point's page lives at and the join to profiles is what carries it.
 */
export async function listStoragePoints(): Promise<StoragePointOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('list_storage_points')
  if (error) throw error
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    username: r.username ?? '',
    name: r.name,
    kind: r.kind as StoragePointKind,
    city: r.city,
    district: r.district,
    address: r.address,
    landmark: r.landmark ?? null,
    phone: r.phone,
    hours: r.hours,
    coverUrl: r.cover_key ? bookImageStorage().publicUrl(r.cover_key) : null,
  }))
}

// One literal, unsplit: supabase-js parses the select list at the type level,
// and a string built with + arrives as an opaque string it cannot read.
const FULL_SELECT =
  'id, profile_id, name, kind, city, district, address, landmark, phone, hours, capacity, website, description, cover_key'

/** The premises belonging to one profile, or null when it is an ordinary person. */
export async function getStoragePointFor(
  profileId: string,
  username: string
): Promise<StoragePoint | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('storage_points')
    .select(FULL_SELECT)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw error
  return data ? toPoint(data as unknown as Row, username) : null
}

/**
 * The venue's own shelf — what it is holding for other people.
 *
 * Only the venue itself can call this and get anything back; the database keeps
 * the list, not this function. What the public sees on a venue's page is what
 * the venue *owns*, which is a different and deliberately public thing.
 */
export async function getMyStoredListings(): Promise<Listing[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('my_stored_copies')
  if (error || !data) return []
  const ids = (data as { copy_id: string }[]).map((r) => r.copy_id)
  return getListingsByIds(ids)
}

/** How many things a point owns and is offering — the donated pool. */
export async function countOwnedBy(profileId: string): Promise<number> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('book_copies')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', profileId)
    .eq('status', 'available')
  return count ?? 0
}

export type StoragePointCard = StoragePointOption & { offerCount: number }

/**
 * The directory, with what each point has to give.
 *
 * It used to count what each venue was *holding* for other people, which is
 * nobody else's business — and was also the wrong number for somebody deciding
 * where to walk: what matters is how many books they could come away with. Two
 * queries rather than one per point.
 */
export async function listStoragePointCards(): Promise<StoragePointCard[]> {
  const points = await listStoragePoints()
  if (points.length === 0) return []

  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, username, book_copies!book_copies_owner_id_fkey ( id, status )')
    .in('username', points.map((p) => p.username))

  type Row = { username: string; book_copies: { id: string; status: string }[] }
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as unknown as Row[]) {
    counts.set(
      row.username,
      (row.book_copies ?? []).filter((c) => c.status === 'available').length
    )
  }
  return points.map((p) => ({ ...p, offerCount: counts.get(p.username) ?? 0 }))
}

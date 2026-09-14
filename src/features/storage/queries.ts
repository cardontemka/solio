import 'server-only'

import { createClient } from '@/lib/supabase/server'
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
  }))
}

// One literal, unsplit: supabase-js parses the select list at the type level,
// and a string built with + arrives as an opaque string it cannot read.
const FULL_SELECT =
  'id, profile_id, name, kind, city, district, address, landmark, phone, hours, capacity, website, description'

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

/** How many things a point is holding right now. */
export async function countStoredAt(pointId: string): Promise<number> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('book_copies')
    .select('id', { count: 'exact', head: true })
    .eq('stored_at', pointId)
  return count ?? 0
}

export type StoragePointCard = StoragePointOption & { storedCount: number }

/**
 * The directory. Two queries rather than one per point: the counts come back in
 * a single grouped read and are matched up here.
 */
export async function listStoragePointCards(): Promise<StoragePointCard[]> {
  const points = await listStoragePoints()
  if (points.length === 0) return []

  const supabase = await createClient()
  const { data } = await supabase
    .from('book_copies')
    .select('stored_at')
    .in('stored_at', points.map((p) => p.id))

  const counts = new Map<string, number>()
  for (const row of (data ?? []) as { stored_at: string | null }[]) {
    if (row.stored_at) counts.set(row.stored_at, (counts.get(row.stored_at) ?? 0) + 1)
  }
  return points.map((p) => ({ ...p, storedCount: counts.get(p.id) ?? 0 }))
}

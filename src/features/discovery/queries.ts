import 'server-only'

import { cache } from 'react'
import { getListingsByIds, type Listing } from '@/features/books/queries'
import type { CategoryStanding } from './order'
import { bookImageStorage } from '@/lib/storage'
import { createClient } from '@/lib/supabase/server'

/**
 * Read side of "what is this reader interested in".
 *
 * The database does the scoring — see
 * supabase/migrations/20260902000630_interest_and_suggestions.sql — because the
 * inputs are three joins over tables the browser cannot see, and because the
 * answer has to be the same for the strip under the header and for the feed.
 *
 * Nothing here is personal data that leaves the person it belongs to: the RPCs
 * read auth.uid() and interest_events is readable by its owner alone.
 */

/**
 * How each category stands: how much the reader has to do with it, and how many
 * books are actually under it right now.
 *
 * Both numbers travel, because the strip needs them for different things — the
 * score to order by, the count to decide whether the heading is worth showing at
 * all. A category with nothing under it leads to an empty shelf whoever clicks
 * it, so the strip leaves it out until somebody lists something.
 *
 * cache() because both the layout and the pages under it ask for it, and it is
 * one answer per request either way.
 */
export const getCategoryStanding = cache(async (): Promise<CategoryStanding> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('category_ranking')
  if (error || !data) return {}
  const rows = data as { category: string; affinity: number; available: number }[]
  const standing: CategoryStanding = {}
  // Affinity decides the order and supply breaks its ties, folded into one
  // number so the client has nothing to weigh up. The supply term is capped
  // below the affinity step, so no amount of stock outranks a single book the
  // reader actually owns.
  for (const row of rows) {
    standing[row.category] = {
      score: Number(row.affinity) * 1000 + Math.min(Number(row.available), 999),
      available: Number(row.available),
    }
  }
  return standing
})

/**
 * The feed's "for you" row.
 *
 * Empty for a signed-out visitor and for an account with no history at all —
 * the RPC returns nothing rather than falling back to "newest", and the page
 * leaves the section out. Calling something a suggestion when it is the same
 * list as the row underneath it is how a feed teaches people to ignore it.
 */
export async function getSuggestedListings(limit = 6): Promise<Listing[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('suggested_copies', { p_limit: limit })
  if (error || !data) return []
  const ids = (data as { copy_id: string }[]).map((row) => row.copy_id)
  return getListingsByIds(ids)
}

export type TopSearch = { query: string; searches: number; people: number }
export type TopItem = {
  copyId: string
  title: string
  author: string | null
  kind: string
  coverUrl: string | null
  ownerName: string
  views: number
  people: number
}
export type TopCategory = {
  category: string
  clicks: number
  people: number
  available: number
}

/**
 * What the whole site is looking for, for the admin page.
 *
 * Three totals, no rows. interest_events itself stays readable by its owner
 * alone — these come back through SECURITY DEFINER functions that check
 * is_staff() and group away every user id on the way out, so a moderator can see
 * that eleven people looked for a title and never which eleven.
 *
 * Refused for anybody who is not staff: the functions return nothing rather than
 * an error, and the page they feed is behind notFound() anyway.
 */
export async function getInterestStats(days = 30, limit = 20): Promise<{
  searches: TopSearch[]
  items: TopItem[]
  categories: TopCategory[]
}> {
  const supabase = await createClient()
  const [searches, items, categories] = await Promise.all([
    supabase.rpc('admin_top_searches', { p_days: days, p_limit: limit }),
    supabase.rpc('admin_top_items', { p_days: days, p_limit: limit }),
    supabase.rpc('admin_top_categories', { p_days: days, p_limit: limit }),
  ])
  const storage = bookImageStorage()
  return {
    searches: ((searches.data ?? []) as TopSearch[]).map((r) => ({
      query: r.query,
      searches: Number(r.searches),
      people: Number(r.people),
    })),
    items: (
      (items.data ?? []) as {
        copy_id: string
        title: string
        author: string | null
        item_kind: string
        cover_key: string | null
        owner_name: string
        views: number
        people: number
      }[]
    ).map((r) => ({
      copyId: r.copy_id,
      title: r.title,
      author: r.author,
      kind: r.item_kind,
      coverUrl: r.cover_key ? storage.publicUrl(r.cover_key) : null,
      ownerName: r.owner_name,
      views: Number(r.views),
      people: Number(r.people),
    })),
    categories: ((categories.data ?? []) as TopCategory[]).map((r) => ({
      category: r.category,
      clicks: Number(r.clicks),
      people: Number(r.people),
      available: Number(r.available),
    })),
  }
}

/**
 * What the site as a whole wants this month.
 *
 * Unlike getSuggestedListings this is the same list for everybody, including a
 * signed-out visitor — it is a fact about the books, not about the reader — so
 * it is the one part of this file that anon may call.
 */
export async function getDemandThisMonth(limit = 6): Promise<Listing[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('demand_this_month', { p_limit: limit })
  if (error || !data) return []
  const ids = (data as { copy_id: string }[]).map((row) => row.copy_id)
  return getListingsByIds(ids)
}

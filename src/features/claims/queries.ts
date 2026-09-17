import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import type { ItemKind } from '@/types/domain'

/**
 * Read side of item codes and claims.
 *
 * A claim is one person saying "I have this thing" and the owner agreeing. The
 * rows live behind RLS that only shows them to those two, and everything below
 * goes through SECURITY DEFINER functions that join in the names and titles
 * neither of them could read from the other's tables.
 */

export type ScannedItem = {
  copyId: string
  code: string
  title: string
  author: string | null
  kind: ItemKind
  status: string
  imageUrl: string | null
  ownerId: string
  ownerName: string
  ownerUsername: string
  storedAtName: string | null
  hasOpenClaim: boolean
  /** Its owner is a storage point: it is taken with a credit, not swapped for. */
  ownerIsPoint: boolean
}

/** What a scanned code points at. Readable signed out — the listing already is. */
export async function findCopyByCode(code: string): Promise<ScannedItem | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('find_copy_by_code', { p_code: code })
  if (error) throw error
  const row = (data ?? [])[0] as
    | {
        copy_id: string
        public_code: string
        title: string
        author: string | null
        kind: ItemKind
        status: string
        cover_key: string | null
        owner_id: string
        owner_name: string
        owner_username: string
        stored_at_name: string | null
        has_open_claim: boolean
        owner_is_point: boolean
      }
    | undefined
  if (!row) return null
  return {
    copyId: row.copy_id,
    code: row.public_code,
    title: row.title,
    author: row.author,
    kind: row.kind ?? 'book',
    status: row.status,
    imageUrl: row.cover_key ? bookImageStorage().publicUrl(row.cover_key) : null,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerUsername: row.owner_username,
    storedAtName: row.stored_at_name,
    hasOpenClaim: row.has_open_claim,
    ownerIsPoint: row.owner_is_point ?? false,
  }
}

export type Claim = {
  claimId: string
  copyId: string
  code: string
  title: string
  author: string | null
  itemKind: ItemKind
  imageUrl: string | null
  /** Custody, or ownership outright. */
  kind: 'storage' | 'ownership'
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'
  note: string | null
  createdAt: string
  expiresAt: string
  /** Which side of it the viewer is on. */
  role: 'owner' | 'claimant'
  otherId: string
  otherName: string
  otherUsername: string
  /**
   * The venue on each side, when there is one. Which of them is set is what
   * separates a donation (the claimant is a venue) from taking a book off a
   * shelf (the owner is) from an ordinary handover between two people.
   */
  claimantPoint: string | null
  ownerPoint: string | null
}

type ClaimRow = {
  claim_id: string
  copy_id: string
  public_code: string
  title: string
  author: string | null
  item_kind: ItemKind
  cover_key: string | null
  kind: 'storage' | 'ownership'
  status: Claim['status']
  note: string | null
  created_at: string
  expires_at: string
  role: 'owner' | 'claimant'
  other_id: string
  other_name: string
  other_user: string
  claimant_point: string | null
  owner_point: string | null
}

function toClaim(row: ClaimRow): Claim {
  return {
    claimId: row.claim_id,
    copyId: row.copy_id,
    code: row.public_code,
    title: row.title,
    author: row.author,
    itemKind: row.item_kind ?? 'book',
    imageUrl: row.cover_key ? bookImageStorage().publicUrl(row.cover_key) : null,
    kind: row.kind,
    status: row.status,
    note: row.note,
    createdAt: row.created_at.slice(0, 10),
    expiresAt: row.expires_at,
    role: row.role,
    otherId: row.other_id,
    otherName: row.other_name,
    otherUsername: row.other_user,
    claimantPoint: row.claimant_point,
    ownerPoint: row.owner_point,
  }
}

/** Every claim the viewer is party to, newest first. */
export async function listMyClaims(): Promise<Claim[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('list_my_claims')
  if (error) throw error
  return ((data ?? []) as ClaimRow[]).map(toClaim)
}

/** The one still waiting on an answer, for a given listing. */
export async function getOpenClaimFor(copyId: string): Promise<Claim | null> {
  const claims = await listMyClaims()
  return claims.find((c) => c.copyId === copyId && c.status === 'pending') ?? null
}

export type ClaimOptions = {
  copyId: string
  /** The thing belongs to a venue: taking it costs a credit. */
  ownerIsPoint: boolean
  /** The viewer is a venue: they can hold it, and taking it is a donation. */
  viewerIsPoint: boolean
  viewerCredits: number
  ownershipCosts: number
  ownershipEarns: number
}

/**
 * What the two buttons on a scanned label would actually do, for this viewer.
 *
 * Asked of the database rather than worked out in the page, because it depends
 * on whether the *other* account is a venue and on a credit balance — neither
 * of which a client may read directly.
 */
export async function getClaimOptions(code: string): Promise<ClaimOptions | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('claim_options', { p_code: code })
  if (error) throw error
  const row = (data ?? [])[0] as
    | {
        copy_id: string
        owner_is_point: boolean
        viewer_is_point: boolean
        viewer_credits: number
        ownership_costs: number
        ownership_earns: number
      }
    | undefined
  if (!row) return null
  return {
    copyId: row.copy_id,
    ownerIsPoint: row.owner_is_point,
    viewerIsPoint: row.viewer_is_point,
    viewerCredits: row.viewer_credits ?? 0,
    ownershipCosts: row.ownership_costs ?? 0,
    ownershipEarns: row.ownership_earns ?? 0,
  }
}

/** The ones waiting on *this* viewer — what the dashboard should shout about. */
export async function getClaimsAwaitingMe(): Promise<Claim[]> {
  const claims = await listMyClaims()
  return claims.filter((c) => c.status === 'pending' && c.role === 'owner')
}

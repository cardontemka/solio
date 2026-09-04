import { bookImageStorage } from '@/lib/storage'

/**
 * A stored avatar key is only ever a key; the public URL is built where it is
 * needed so a change of storage provider does not have to rewrite rows.
 */
export function avatarUrl(key: string | null | undefined): string | null {
  if (!key) return null
  return bookImageStorage().publicUrl(key)
}

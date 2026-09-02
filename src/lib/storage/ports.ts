/**
 * Object storage for book images.
 *
 * Two implementations exist and they must never be confused for each other:
 *   · R2BookImageStorage    — production
 *   · LocalDevelopmentStorage — dev only, refuses to run in production
 *
 * `provider` is stored on every book_images row so a listing can always be
 * traced back to where its bytes actually live.
 */

export type StorageProvider = 'r2' | 'local'

export type UploadTarget = {
  /** Where the browser PUTs the bytes. */
  url: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

export interface BookImageStorage {
  readonly provider: StorageProvider
  /** A short-lived, single-key upload target. */
  createUploadTarget(input: {
    storageKey: string
    mimeType: string
    byteSize: number
  }): Promise<UploadTarget>
  /** First N bytes, for server-side magic-number and dimension verification. */
  readHead(storageKey: string, bytes: number): Promise<Uint8Array | null>
  stat(storageKey: string): Promise<{ byteSize: number } | null>
  delete(storageKey: string): Promise<void>
  publicUrl(storageKey: string): string
}

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedMime = (typeof ALLOWED_MIME)[number]

export const MAX_BYTES = 5 * 1024 * 1024
export const MIN_BYTES = 1024
export const MAX_IMAGES_PER_COPY = 8
export const MIN_DIMENSION = 200
export const MAX_DIMENSION = 8000

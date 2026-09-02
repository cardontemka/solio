import 'server-only'

import { LocalDevelopmentStorage } from './local'
import { R2BookImageStorage } from './r2'
import type { BookImageStorage } from './ports'

/**
 * Picks the provider from the environment. Production and development are
 * deliberately impossible to confuse:
 *   · the provider is recorded on every book_images row
 *   · local URLs are relative, so they cannot resolve against a CDN
 *   · booting production on local storage throws here, naming the missing vars
 */
const R2_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'NEXT_PUBLIC_R2_PUBLIC_URL',
] as const

function build(): BookImageStorage {
  const present = R2_VARS.filter((k) => (process.env[k] ?? '').length > 0)
  const missing = R2_VARS.filter((k) => (process.env[k] ?? '').length === 0)

  if (missing.length === 0) {
    return new R2BookImageStorage({
      accountId: process.env.R2_ACCOUNT_ID!,
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      bucket: process.env.R2_BUCKET_NAME!,
      publicUrl: process.env.NEXT_PUBLIC_R2_PUBLIC_URL!,
    })
  }

  // Partly configured is almost always a mistake rather than a choice, and
  // falling back silently would hide it until images render broken.
  if (present.length > 0 && process.env.NODE_ENV !== 'production') {
    console.warn(
      `\n  ⚠  R2 хагас тохируулагдсан тул LOCAL storage ашиглаж байна.\n` +
        `     Дутуу: ${missing.join(', ')}\n` +
        `     Бүрэн тохируулах: docs/setup.md STEP 5.\n`
    )
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL: image storage is unconfigured in production. LocalDevelopmentStorage ' +
        'writes to the filesystem and must never run here. Set R2_ACCOUNT_ID, ' +
        'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and ' +
        'NEXT_PUBLIC_R2_PUBLIC_URL — see docs/setup.md STEP 5.'
    )
  }

  return new LocalDevelopmentStorage()
}

let cached: BookImageStorage | null = null

export function bookImageStorage(): BookImageStorage {
  cached ??= build()
  return cached
}

export type { BookImageStorage } from './ports'

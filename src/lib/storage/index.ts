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
function build(): BookImageStorage {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL

  if (accountId && accessKeyId && secretAccessKey && bucket && publicUrl) {
    return new R2BookImageStorage({ accountId, accessKeyId, secretAccessKey, bucket, publicUrl })
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

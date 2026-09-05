import 'server-only'

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { BookImageStorage, UploadTarget } from './ports'

/**
 * ⚠️ DEVELOPMENT ONLY — writes to public/uploads on the local filesystem.
 *
 * Unlike R2 there is no presigned URL, so the upload target points back at our
 * own Route Handler. Every other guarantee (server-side sniffing, the
 * `pending → ready` lifecycle) is identical, so switching to R2 changes only
 * where the bytes land.
 *
 * Serverless filesystems are read-only, which is why index.ts refuses to boot
 * production with this provider selected.
 */
const ROOT = resolve(process.cwd(), 'public', 'uploads')

function safePath(storageKey: string): string {
  // The key shape is already constrained by a CHECK constraint in the
  // database; this is the second lock on the same door.
  if (!/^copies\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(storageKey)) {
    throw new Error('unsafe storage key')
  }
  const full = join(ROOT, storageKey)
  if (!full.startsWith(ROOT)) throw new Error('path escape')
  return full
}

export class LocalDevelopmentStorage implements BookImageStorage {
  readonly provider = 'local' as const

  async createUploadTarget(input: { storageKey: string; mimeType: string }): Promise<UploadTarget> {
    return {
      // Key travels as a query parameter: it contains slashes, and encoded
      // slashes inside a path segment are handled inconsistently by proxies.
      url: `/api/uploads/local?key=${encodeURIComponent(input.storageKey)}`,
      method: 'PUT',
      headers: { 'content-type': input.mimeType },
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }
  }

  /** Same contract as the R2 adapter; the local one already wrote this way. */
  // The mime type is not needed on disk; the interface carries it for R2.
  async put(storageKey: string, bytes: Uint8Array): Promise<void> {
    await this.write(storageKey, bytes)
  }

  async write(storageKey: string, bytes: Uint8Array): Promise<void> {
    const path = safePath(storageKey)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }

  async readHead(storageKey: string, bytes: number): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(safePath(storageKey))
      return new Uint8Array(buf.subarray(0, bytes))
    } catch {
      return null
    }
  }

  async stat(storageKey: string) {
    try {
      const s = await stat(safePath(storageKey))
      return { byteSize: s.size }
    } catch {
      return null
    }
  }

  async delete(storageKey: string): Promise<void> {
    await rm(safePath(storageKey), { force: true })
  }

  publicUrl(storageKey: string): string {
    // A relative path, which cannot resolve against a CDN — one more reason a
    // local-storage image can never be mistaken for a production one.
    return `/uploads/${storageKey}`
  }
}

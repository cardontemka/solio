import 'server-only'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { BookImageStorage, UploadTarget } from './ports'

/**
 * A key contains a uuid and the bytes under it are never rewritten — a new photo
 * is a new key — so the object may be cached until the browser forgets it.
 *
 * Without this R2 answers with no Cache-Control at all, which leaves every cover
 * to the browser's heuristics: in practice a conditional request per image per
 * visit, and a feed is twenty of them before anything is drawn.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * Production storage. The browser PUTs straight to R2, so image bytes never
 * pass through the application — which also keeps uploads clear of the
 * platform's request body limit.
 */
export class R2BookImageStorage implements BookImageStorage {
  readonly provider = 'r2' as const
  private readonly client: S3Client
  private readonly bucket: string
  private readonly publicHost: string

  constructor(config: {
    accountId: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
    publicUrl: string
  }) {
    this.bucket = config.bucket
    this.publicHost = config.publicUrl.replace(/\/+$/, '')
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  async createUploadTarget(input: {
    storageKey: string
    mimeType: string
    byteSize: number
  }): Promise<UploadTarget> {
    const ttl = 300
    // Signing ContentType and ContentLength binds the URL to exactly the
    // object that was authorised — it cannot be reused for anything else.
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.storageKey,
        ContentType: input.mimeType,
        ContentLength: input.byteSize,
        CacheControl: IMMUTABLE,
      }),
      { expiresIn: ttl }
    )
    return {
      url,
      method: 'PUT',
      // Signed above, so the browser has to send it back verbatim or R2 rejects
      // the PUT; uploadImage() forwards whatever is listed here.
      headers: { 'content-type': input.mimeType, 'cache-control': IMMUTABLE },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    }
  }

  async put(storageKey: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: bytes,
        ContentType: mimeType,
        ContentLength: bytes.byteLength,
        CacheControl: IMMUTABLE,
      })
    )
  }

  async readHead(storageKey: string, bytes: number): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          Range: `bytes=0-${bytes - 1}`,
        })
      )
      const array = await res.Body?.transformToByteArray()
      return array ?? null
    } catch {
      return null
    }
  }

  async stat(storageKey: string) {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey })
      )
      return { byteSize: res.ContentLength ?? 0 }
    } catch {
      return null
    }
  }

  async delete(storageKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }))
  }

  publicUrl(storageKey: string): string {
    return `${this.publicHost}/${storageKey}`
  }
}

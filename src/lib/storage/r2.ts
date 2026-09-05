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
      }),
      { expiresIn: ttl }
    )
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': input.mimeType },
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

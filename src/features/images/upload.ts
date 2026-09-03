'use client'

import { confirmImageAction } from './actions'

/**
 * The browser half of the three-step upload: ask the server for a target, send
 * the bytes straight to storage, then ask the server to verify and publish
 * them.
 *
 * Every rule below is repeated on the server, which additionally sniffs the
 * real bytes — these checks exist only so the reader hears about a bad file
 * before spending their bandwidth on it. Shared by ImageUploader and the Add
 * Book form so one protocol has one implementation.
 */
export const IMAGE_ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const IMAGE_MIN_BYTES = 1024
export const IMAGE_MAX_COUNT = 8
const MIN_DIM = 200
const MAX_DIM = 8000

/** Returns a Mongolian message describing the problem, or null if the file is fine. */
export async function checkImageFile(file: File): Promise<string | null> {
  if (!(IMAGE_ALLOWED as readonly string[]).includes(file.type)) {
    return 'Зөвхөн JPEG, PNG, WebP зураг байршуулна.'
  }
  if (file.size < IMAGE_MIN_BYTES || file.size > IMAGE_MAX_BYTES) {
    return 'Зургийн хэмжээ 1KB–5MB хооронд байх ёстой.'
  }
  let dims: { width: number; height: number } | null = null
  try {
    const bitmap = await createImageBitmap(file)
    dims = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
  } catch {
    return 'Файлыг зураг гэж уншиж чадсангүй.'
  }
  if (
    dims.width < MIN_DIM || dims.width > MAX_DIM ||
    dims.height < MIN_DIM || dims.height > MAX_DIM
  ) {
    return `Зураг ${MIN_DIM}–${MAX_DIM}px хооронд байх ёстой.`
  }
  return null
}

export type UploadResult = { ok: true } | { ok: false; message: string }

/** PUT the bytes with progress. XHR rather than fetch because only XHR reports it. */
function put(
  url: string,
  method: string,
  headers: Record<string, string>,
  file: File,
  onProgress?: (percent: number) => void
): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, String(v))
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    // Every terminal event resolves, so a dropped connection surfaces as a
    // failed upload instead of a promise that never settles.
    xhr.onload = () => resolve(xhr.status)
    xhr.onerror = () => resolve(0)
    xhr.onabort = () => resolve(0)
    xhr.ontimeout = () => resolve(0)
    xhr.send(file)
  })
}

export async function uploadImageToCopy(
  copyId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadResult> {
  const invalid = await checkImageFile(file)
  if (invalid) return { ok: false, message: invalid }

  try {
    const res = await fetch('/api/uploads/book-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ copyId, mimeType: file.type, byteSize: file.size }),
    })
    const intent = await res.json()
    if (!res.ok) return { ok: false, message: intent.error ?? 'Зураг нэмэх боломжгүй байна.' }

    const status = await put(
      intent.upload.url,
      intent.upload.method,
      intent.upload.headers,
      file,
      onProgress
    )
    if (status < 200 || status >= 300) return { ok: false, message: 'Зураг байршуулж чадсангүй.' }
    onProgress?.(100)

    const confirmed = await confirmImageAction(intent.imageId)
    if (!confirmed.ok) return { ok: false, message: confirmed.message }
    return { ok: true }
  } catch {
    return { ok: false, message: 'Сүлжээний алдаа. Дахин оролдоно уу.' }
  }
}

'use client'

import { confirmImageAction } from './actions'

/**
 * The browser half of the three-step upload: ask the server for a target, send
 * the bytes straight to storage, then ask the server to verify and publish
 * them.
 *
 * Phone photos do not fit the server's rules as they come off the camera: they
 * are 3–12MB, often HEIC, and carry an EXIF rotation that only some viewers
 * honour. Rejecting them was the reason uploading from a phone failed. So the
 * file is re-drawn through a canvas first — that resolves the format to
 * whatever the browser can decode, applies the rotation for real, and brings
 * the size under the cap — and what gets uploaded is always a JPEG.
 */
export const IMAGE_ACCEPT = 'image/*'
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const IMAGE_MAX_COUNT = 8
const MAX_EDGE = 1600
const MIN_EDGE = 200
const MAX_SOURCE_BYTES = 32 * 1024 * 1024
const JPEG_QUALITY = 0.85

/**
 * The second, small copy that grids show.
 *
 * A book card is about 180px wide, and 480 covers it on a 2× screen with room
 * for the larger cards on a desktop grid. Made here rather than by an image
 * service because the browser has already decoded the photo to draw the preview
 * — a second canvas pass costs milliseconds, and it means no per-image
 * transformation is metered anywhere.
 */
const THUMB_EDGE = 480
const THUMB_QUALITY = 0.72

/** The thumbnail's key is the original's, with `-t` before the extension. */
export function thumbKeyFor(storageKey: string): string {
  return storageKey.replace(/\.(jpg|jpeg|png|webp)$/i, '-t.jpg')
}

export type Prepared =
  | { ok: true; file: File; thumb: File | null }
  | { ok: false; message: string }

/** Decode via <img>, which handles every format the browser can display. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode failed'))
    }
    img.src = url
  })
}

async function toBitmapSize(file: File): Promise<{ width: number; height: number } | null> {
  // createImageBitmap applies EXIF rotation when asked, so the dimensions match
  // what the reader actually sees. Not every browser has it for every format,
  // hence the <img> fallback.
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    try {
      const img = await loadImage(file)
      return { width: img.naturalWidth, height: img.naturalHeight }
    } catch {
      return null
    }
  }
}

async function drawToCanvas(file: File, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
  } catch {
    const img = await loadImage(file)
    ctx.drawImage(img, 0, 0, width, height)
  }
  return canvas
}

/**
 * Returns an upload-ready JPEG, or a message naming what is wrong with the
 * file. The server repeats every rule and sniffs the real bytes; this exists so
 * the reader hears about a bad file before spending their data on it.
 */
export async function prepareImage(file: File): Promise<Prepared> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    return { ok: false, message: 'Зөвхөн зураг байршуулна.' }
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return { ok: false, message: 'Файл хэт том байна (32MB-аас бага байх ёстой).' }
  }

  const size = await toBitmapSize(file)
  if (!size) {
    return { ok: false, message: 'Файлыг зураг гэж уншиж чадсангүй. Өөр зураг сонгоно уу.' }
  }
  if (Math.min(size.width, size.height) < MIN_EDGE) {
    return { ok: false, message: `Зураг хэт жижиг байна (богино тал нь ${MIN_EDGE}px-ээс их байх ёстой).` }
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(size.width, size.height))
  const width = Math.round(size.width * scale)
  const height = Math.round(size.height * scale)

  let canvas: HTMLCanvasElement
  try {
    canvas = await drawToCanvas(file, width, height)
  } catch {
    return { ok: false, message: 'Зургийг боловсруулж чадсангүй. Дахин оролдоно уу.' }
  }

  // Quality steps down rather than failing: a 12MP photo of a dense page can
  // still land over the cap at 0.85.
  for (const quality of [JPEG_QUALITY, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    )
    if (!blob) break
    if (blob.size <= IMAGE_MAX_BYTES) {
      const name = file.name.replace(/\.[^.]+$/, '') || 'photo'
      const full = new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
      return { ok: true, file: full, thumb: await makeThumb(file, size, name) }
    }
  }
  return { ok: false, message: 'Зургийг шаардлагатай хэмжээнд шахаж чадсангүй.' }
}

/**
 * The grid-sized copy. Returns null rather than failing the upload: a listing
 * with no thumbnail falls back to the full image, which is worse but not broken,
 * and losing the whole photo over the small copy would be the wrong trade.
 */
async function makeThumb(
  file: File,
  size: { width: number; height: number },
  name: string
): Promise<File | null> {
  const longest = Math.max(size.width, size.height)
  // Already small enough that a second file would only cost a round trip.
  if (longest <= THUMB_EDGE) return null

  try {
    const scale = THUMB_EDGE / longest
    const canvas = await drawToCanvas(
      file,
      Math.round(size.width * scale),
      Math.round(size.height * scale)
    )
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY)
    )
    return blob ? new File([blob], `${name}-t.jpg`, { type: 'image/jpeg' }) : null
  } catch {
    return null
  }
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

/**
 * Send the bytes through the application instead of straight to storage.
 *
 * Used when the direct PUT fails, which in practice means the page's origin is
 * not in the bucket's CORS list — a preview deployment, a new domain, or a
 * phone pointed at a laptop over the LAN. The file is already about 100KB by
 * this point, so the detour is cheap.
 */
export async function putViaServer(storageKey: string, file: File): Promise<boolean> {
  try {
    const res = await fetch(`/api/uploads/bytes?key=${encodeURIComponent(storageKey)}`, {
      method: 'POST',
      headers: { 'content-type': file.type },
      body: file,
    })
    return res.ok
  } catch {
    return false
  }
}

export async function uploadImageToCopy(
  copyId: string,
  original: File,
  onProgress?: (percent: number) => void
): Promise<UploadResult> {
  const prepared = await prepareImage(original)
  if (!prepared.ok) return prepared
  const file = prepared.file
  const thumb = prepared.thumb

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

    if (status < 200 || status >= 300) {
      // status 0 is what a blocked CORS preflight looks like from here.
      const viaServer = await putViaServer(intent.storageKey, file)
      if (!viaServer) return { ok: false, message: 'Зураг байршуулж чадсангүй.' }
    }
    onProgress?.(100)

    // The small copy rides along on its own target. A failure here is not fatal
    // — the reader still gets their photo, and the grid falls back to it.
    let thumbUploaded = false
    if (thumb && intent.thumbUpload) {
      const thumbKey = thumbKeyFor(intent.storageKey)
      const thumbStatus = await put(
        intent.thumbUpload.url,
        intent.thumbUpload.method,
        intent.thumbUpload.headers,
        thumb
      )
      thumbUploaded =
        (thumbStatus >= 200 && thumbStatus < 300) || (await putViaServer(thumbKey, thumb))
    }

    const confirmed = await confirmImageAction(intent.imageId, thumbUploaded)
    if (!confirmed.ok) return { ok: false, message: confirmed.message }
    return { ok: true }
  } catch {
    return { ok: false, message: 'Сүлжээний алдаа. Дахин оролдоно уу.' }
  }
}

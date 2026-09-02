'use client'

import Image from 'next/image'
import { useRef, useState, useTransition } from 'react'
import {
  confirmImageAction,
  getCopyImagesAction,
  removeImageAction,
  type ImageView as ExistingImage,
} from './actions'
import styles from './ImageUploader.module.css'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024
const MIN_BYTES = 1024
const MAX_IMAGES = 8
const MIN_DIM = 200
const MAX_DIM = 8000

type UploadProgress = {
  name: string
  percent: number
}

/**
 * Three-step upload: ask the server for a target, send the bytes straight to
 * storage, then ask the server to verify and publish them.
 *
 * The checks here are for feedback only — every one of them is repeated on the
 * server, which additionally sniffs the real bytes. Nothing this component
 * sends is trusted.
 */
export function ImageUploader({
  copyId,
  images: initialImages,
}: {
  copyId: string
  images: ExistingImage[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<ExistingImage[]>(initialImages)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const remaining = MAX_IMAGES - images.length

  /** Pull the fresh list from the server so a just-published image shows up. */
  async function refresh() {
    const res = await getCopyImagesAction(copyId)
    if (res.ok) setImages(res.images)
  }

  async function measure(file: File): Promise<{ width: number; height: number } | null> {
    try {
      const bitmap = await createImageBitmap(file)
      const dims = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return dims
    } catch {
      return null
    }
  }

  async function upload(file: File) {
    setError(null)

    if (!ALLOWED.includes(file.type)) {
      setError('Зөвхөн JPEG, PNG, WebP зураг байршуулна.')
      return
    }
    if (file.size < MIN_BYTES || file.size > MAX_BYTES) {
      setError('Зургийн хэмжээ 1KB–5MB хооронд байх ёстой.')
      return
    }
    const dims = await measure(file)
    if (!dims) {
      setError('Файлыг зураг гэж уншиж чадсангүй.')
      return
    }
    if (
      dims.width < MIN_DIM || dims.width > MAX_DIM ||
      dims.height < MIN_DIM || dims.height > MAX_DIM
    ) {
      setError(`Зураг ${MIN_DIM}–${MAX_DIM}px хооронд байх ёстой.`)
      return
    }

    setBusy(file.name)
    setProgress({ name: file.name, percent: 0 })
    try {
      const res = await fetch('/api/uploads/book-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ copyId, mimeType: file.type, byteSize: file.size }),
      })
      const intent = await res.json()
      if (!res.ok) {
        setError(intent.error ?? 'Зураг нэмэх боломжгүй байна.')
        return
      }

      const put = await new Promise<Response>((resolve) => {
        const xhr = new XMLHttpRequest()
        xhr.open(intent.upload.method, intent.upload.url)
        for (const [k, v] of Object.entries(intent.upload.headers ?? {})) {
          xhr.setRequestHeader(k, String(v))
        }
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress({ name: file.name, percent: Math.round((e.loaded / e.total) * 100) })
          }
        }
        xhr.onload = () => resolve(
          new Response(null, { status: xhr.status, statusText: xhr.statusText })
        )
        xhr.onerror = () => resolve(new Response(null, { status: 0 }))
        xhr.send(file)
      })

      if (!put.ok) {
        setError('Зураг байршуулж чадсангүй.')
        return
      }
      setProgress({ name: file.name, percent: 100 })

      const confirmed = await confirmImageAction(intent.imageId)
      if (!confirmed.ok) {
        setError(confirmed.message)
        return
      }
      await refresh()
    } catch {
      setError('Сүлжээний алдаа. Дахин оролдоно уу.')
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  return (
    <div className={styles.wrap}>
      {images.length > 0 && (
        <ul className={styles.grid}>
          {images.map((img, i) => (
            <li key={img.id} className={styles.thumb}>
              <Image src={img.url} alt="" width={74} height={111} />
              {i === 0 && <span className={styles.primary}>Үндсэн</span>}
              <button
                type="button"
                className={styles.remove}
                aria-label="Зураг устгах"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await removeImageAction(img.id)
                    if (!r.ok) setError(r.message)
                    else await refresh()
                  })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED.join(',')}
            multiple
            hidden
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []).slice(0, remaining)
              for (const f of files) await upload(f)
              if (inputRef.current) inputRef.current.value = ''
            }}
          />
          <button
            type="button"
            className={styles.add}
            disabled={busy !== null || pending}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? `Байршуулж байна: ${progress?.percent ?? 0}%` : `+ Зураг нэмэх (${remaining} үлдсэн)`}
          </button>
          {progress && (
            <div className={styles.progress}>
              <div className={styles.progressBar} style={{ width: `${progress.percent}%` }} />
            </div>
          )}
        </>
      ) : (
        <p className={styles.full}>Хамгийн ихдээ {MAX_IMAGES} зураг нэмэгдсэн.</p>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
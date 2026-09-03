'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import {
  getCopyImagesAction,
  removeImageAction,
  type ImageView as ExistingImage,
} from './actions'
import { IMAGE_ALLOWED, IMAGE_MAX_COUNT, uploadImageToCopy } from './upload'
import styles from './ImageUploader.module.css'

/**
 * Adds photos to a copy that already exists.
 *
 * The upload protocol itself lives in ./upload so the Add Book form runs the
 * same one. Two refreshes follow a change: the local list, so the thumbnails
 * update instantly, and router.refresh(), so the rest of the page — cover
 * image, counts — stops disagreeing with it.
 */
export function ImageUploader({
  copyId,
  images: initialImages,
}: {
  copyId: string
  images: ExistingImage[]
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<ExistingImage[]>(initialImages)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const remaining = IMAGE_MAX_COUNT - images.length

  async function refresh() {
    const res = await getCopyImagesAction(copyId)
    if (res.ok) setImages(res.images)
    router.refresh()
  }

  async function upload(file: File) {
    setError(null)
    setBusy(file.name)
    setProgress(0)
    const res = await uploadImageToCopy(copyId, file, setProgress)
    if (!res.ok) setError(res.message)
    else await refresh()
    setBusy(null)
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
                disabled={pending || busy !== null}
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
            accept={IMAGE_ALLOWED.join(',')}
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
            {busy ? `Байршуулж байна: ${progress}%` : `+ Зураг нэмэх (${remaining} үлдсэн)`}
          </button>
          {busy && (
            <div className={styles.progress}>
              <div className={styles.progressBar} style={{ width: `${progress}%` }} />
            </div>
          )}
        </>
      ) : (
        <p className={styles.full}>Хамгийн ихдээ {IMAGE_MAX_COUNT} зураг нэмэгдсэн.</p>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { IMAGE_ACCEPT, prepareImage, putViaServer } from '@/features/images/upload'
import {
  removeStoragePointCoverAction,
  setStoragePointCoverAction,
} from './actions'
import styles from './CoverPicker.module.css'

/**
 * The photograph of the place, and the one picture on this site that is meant
 * to be seen from across a list.
 *
 * Same three-step upload as book photos and avatars — ask for a target, PUT the
 * bytes, attach the key — and the same client-side re-encode first, so a 12MP
 * phone photo becomes a 1600px JPEG before it leaves the device.
 */
export function CoverPicker({ initialUrl }: { initialUrl: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(initialUrl)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Object URLs are a browser resource, not React state.
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview]
  )

  async function upload(original: File) {
    setError(null)
    setBusy(true)
    try {
      const prepared = await prepareImage(original)
      if (!prepared.ok) {
        setError(prepared.message)
        return
      }
      const local = URL.createObjectURL(prepared.file)
      setPreview(local)

      const res = await fetch('/api/uploads/cover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mimeType: prepared.file.type, byteSize: prepared.file.size }),
      })
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? 'Байршуулж чадсангүй.')
        return
      }
      const intent = await res.json()

      // Straight to the bucket when CORS allows it, through our own route when
      // it does not — the same two-step every other upload here takes.
      let stored = false
      try {
        const direct = await fetch(intent.upload.url, {
          method: intent.upload.method,
          headers: intent.upload.headers,
          body: prepared.file,
        })
        stored = direct.ok
      } catch {
        // A blocked CORS preflight throws rather than returning a status.
        stored = false
      }
      if (!stored) stored = await putViaServer(intent.storageKey, prepared.file)
      if (!stored) {
        setError('Зураг байршуулж чадсангүй.')
        return
      }
      const saved = await setStoragePointCoverAction(intent.storageKey)
      if (!saved.ok) {
        setError(saved.message)
        return
      }
      setUrl(saved.url)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const shown = preview ?? url

  return (
    <div className={styles.wrap}>
      <div className={styles.frame} data-empty={!shown}>
        {shown ? (
          <Image className={styles.image} src={shown} alt="" fill sizes="600px" unoptimized />
        ) : (
          <p className={styles.placeholder}>Зураг оруулаагүй байна</p>
        )}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.button}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Байршуулж байна…' : shown ? 'Зураг солих' : 'Зураг нэмэх'}
        </button>
        {url && (
          <button
            type="button"
            className={styles.remove}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const r = await removeStoragePointCoverAction()
              if (!r.ok) setError(r.message)
              else {
                setUrl(null)
                setPreview(null)
              }
              setBusy(false)
            }}
          >
            Устгах
          </button>
        )}
        <input
          ref={fileRef}
          className={styles.file}
          type="file"
          accept={IMAGE_ACCEPT}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) await upload(file)
          }}
        />
      </div>

      <p className={styles.hint}>
        Байрныхаа зургийг оруулбал хайлтын жагсаалт, хуудсан дээр тань бүтнээрээ
        харагдана. Өргөн зураг илүү тохиромжтой.
      </p>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

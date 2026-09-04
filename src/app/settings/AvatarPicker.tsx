'use client'

import Image from 'next/image'
import { useRef, useState, useTransition } from 'react'
import { removeAvatarAction, setAvatarAction } from '@/features/users/actions'
import styles from './page.module.css'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 2 * 1024 * 1024
const MIN_BYTES = 1024

/**
 * Same three-step upload the book photos use — ask for a target, PUT the bytes
 * straight to storage, then let the server verify them — so an avatar never
 * travels through the application and never bypasses the byte check.
 */
export function AvatarPicker({
  name,
  initialUrl,
}: {
  name: string
  initialUrl: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function upload(file: File) {
    setError(null)
    if (!ALLOWED.includes(file.type)) {
      setError('Зөвхөн JPEG, PNG, WebP зураг байршуулна.')
      return
    }
    if (file.size < MIN_BYTES || file.size > MAX_BYTES) {
      setError('Зургийн хэмжээ 1KB–2MB хооронд байх ёстой.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/uploads/avatar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mimeType: file.type, byteSize: file.size }),
      })
      const intent = await res.json()
      if (!res.ok) {
        setError(intent.error ?? 'Зураг нэмэх боломжгүй байна.')
        return
      }

      const put = await fetch(intent.upload.url, {
        method: intent.upload.method,
        headers: intent.upload.headers,
        body: file,
      })
      if (!put.ok) {
        setError('Зураг байршуулж чадсангүй.')
        return
      }

      const saved = await setAvatarAction(intent.storageKey)
      if (!saved.ok) setError(saved.message)
      else setUrl(saved.url)
    } catch {
      setError('Сүлжээний алдаа. Дахин оролдоно уу.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.avatarRow}>
      <span className={styles.avatarPreview} aria-hidden="true">
        {url ? (
          <Image src={url} alt="" width={144} height={144} />
        ) : (
          name.charAt(0).toUpperCase()
        )}
      </span>

      <div className={styles.avatarControls}>
        <p className={styles.avatarLabel}>Профайл зураг</p>
        <p className={styles.avatarHint}>JPEG, PNG, WebP · 2MB хүртэл</p>

        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED.join(',')}
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) await upload(file)
            if (inputRef.current) inputRef.current.value = ''
          }}
        />

        <div className={styles.avatarButtons}>
          <button
            type="button"
            className={styles.avatarButton}
            disabled={busy || pending}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Байршуулж байна…' : url ? 'Солих' : 'Зураг сонгох'}
          </button>
          {url && (
            <button
              type="button"
              className={styles.avatarRemove}
              disabled={busy || pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await removeAvatarAction()
                  if (!r.ok) setError(r.message)
                  else setUrl(null)
                })
              }
            >
              Устгах
            </button>
          )}
        </div>

        {error && <p className={styles.avatarError}>{error}</p>}
      </div>
    </div>
  )
}

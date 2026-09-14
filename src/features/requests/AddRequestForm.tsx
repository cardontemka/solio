'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FieldError, FormMessage } from '@/components/FormError'
import { IMAGE_ACCEPT, prepareImage, uploadImageToRequest } from '@/features/images/upload'
import { createRequestAction, type RequestState } from './actions'
import formStyles from '@/components/forms.module.css'
import styles from './MyRequestsPanel.module.css'

const initial: RequestState = { ok: false }

/**
 * Post a request. Free text: there is no catalogue to pick from.
 *
 * One optional photo — usually the cover, which is how most people recognise a
 * book they own. Like the add-book form, it is submitted by hand rather than
 * through useActionState, because the upload can only happen once the request
 * row exists to hang it on.
 */
export function AddRequestForm() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [state, setState] = useState<RequestState>(initial)
  const [picked, setPicked] = useState<{ file: File; preview: string } | null>(null)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'uploading'>('idle')
  const [imageError, setImageError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)

  const pending = phase !== 'idle'
  const errors = !state.ok ? state.errors : undefined

  // Object URLs are a browser resource, not React state.
  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.preview)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function choose(file: File | undefined) {
    if (!file) return
    setImageError(null)
    setPreparing(true)
    try {
      const prepared = await prepareImage(file)
      if (!prepared.ok) {
        setImageError(prepared.message)
        return
      }
      setPicked((prev) => {
        if (prev) URL.revokeObjectURL(prev.preview)
        return { file: prepared.file, preview: URL.createObjectURL(prepared.file) }
      })
    } finally {
      setPreparing(false)
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    setImageError(null)
    setPhase('saving')
    const form = event.currentTarget
    const result = await createRequestAction(initial, new FormData(form))
    setState(result)

    if (!result.ok || !result.id) {
      setPhase('idle')
      return
    }

    // The request exists from here on. A failed photo is reported but never
    // undoes the post — the words are the part that matters.
    if (picked) {
      setPhase('uploading')
      const up = await uploadImageToRequest(result.id, picked.file)
      if (!up.ok) {
        setImageError(`Сураглал нийтлэгдлээ. Зураг орсонгүй — ${up.message}`)
        setPhase('idle')
        form.reset()
        setPicked(null)
        router.refresh()
        return
      }
    }

    form.reset()
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview)
      return null
    })
    setPhase('idle')
    router.refresh()
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className={styles.addForm}>
      {!state.ok && <FormMessage message={state.message} />}
      {state.ok && <p className={styles.posted}>✓ Сураглал нийтлэгдлээ.</p>}

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="req-title">
          Юу сураглаж байна?
        </label>
        <input
          className={formStyles.input}
          id="req-title"
          name="title"
          type="text"
          required
          maxLength={300}
          placeholder="Монголын нууц товчоо"
        />
        <FieldError errors={errors?.title} />
      </div>

      <div className={formStyles.row}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="req-author">
            Зохиогч
            <span className={formStyles.optional}>заавал биш</span>
          </label>
          <input
            className={formStyles.input}
            id="req-author"
            name="author"
            type="text"
            maxLength={200}
          />
          <FieldError errors={errors?.author} />
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="req-isbn">
            ISBN
            <span className={formStyles.optional}>заавал биш</span>
          </label>
          <input
            className={formStyles.input}
            id="req-isbn"
            name="isbn"
            type="text"
            maxLength={32}
            inputMode="numeric"
          />
          <FieldError errors={errors?.isbn} />
        </div>
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="req-note">
          Нэмэлт
          <span className={formStyles.optional}>заавал биш</span>
        </label>
        <textarea
          className={formStyles.textarea}
          id="req-note"
          name="note"
          rows={2}
          maxLength={500}
          placeholder="Ямар хэвлэл, ямар нөхцөлд байхыг хүсэж байна…"
        />
        <FieldError errors={errors?.note} />
      </div>

      <div className={formStyles.field}>
        <span className={formStyles.label}>
          Зураг
          <span className={formStyles.optional}>заавал биш</span>
        </span>
        {/* A label rather than a button calling input.click(): several mobile
            browsers refuse to open the picker for a display:none input. */}
        <input
          id="req-photo"
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className={styles.fileInput}
          onChange={async (e) => {
            await choose(e.target.files?.[0])
            if (fileRef.current) fileRef.current.value = ''
          }}
        />
        <div className={styles.photoRow}>
          {picked && (
            /* Local object URL, so next/image would only add indirection. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className={styles.photoPreview} src={picked.preview} alt="" />
          )}
          <label htmlFor="req-photo" className={styles.photoButton} data-disabled={pending || preparing}>
            {preparing ? 'Бэлдэж байна…' : picked ? 'Өөр зураг' : 'Зураг сонгох'}
          </label>
          {picked && (
            <button
              type="button"
              className={styles.photoRemove}
              disabled={pending}
              onClick={() =>
                setPicked((prev) => {
                  if (prev) URL.revokeObjectURL(prev.preview)
                  return null
                })
              }
            >
              Хасах
            </button>
          )}
        </div>
        <span className={formStyles.hint}>
          Хавтасны зураг байвал хүмүүс таних нь амархан.
        </span>
        {imageError && <p className={formStyles.error}>{imageError}</p>}
      </div>

      <div className={styles.addActions}>
        <button className={formStyles.submit} type="submit" disabled={pending}>
          {phase === 'saving'
            ? 'Нийтэлж байна…'
            : phase === 'uploading'
              ? 'Зураг байршуулж байна…'
              : 'Сураглал нийтлэх'}
        </button>
      </div>
    </form>
  )
}

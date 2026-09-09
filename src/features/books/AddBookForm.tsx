'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import {
  IMAGE_ACCEPT,
  IMAGE_MAX_COUNT,
  prepareImage,
  uploadImageToCopy,
} from '@/features/images/upload'
import { BOOK_CONDITION, CONDITION_LABEL } from '@/types/domain'
import { CatalogueField } from './CatalogueField'
import { CategoryPicker } from './CategoryPicker'
import type { CatalogueMatch } from './queries'
import { createBookAction, type ActionState } from './actions'
import formStyles from '@/components/forms.module.css'
import styles from './AddBookForm.module.css'

/**
 * Registering one's own copy, in a single submit.
 *
 * Photos are chosen before saving but can only be uploaded after, because an
 * upload is authorised against a book_copy row that does not exist yet. So the
 * files wait in local state, the action creates book + copy, and the uploads
 * follow immediately — the reader sees one action, not two steps.
 *
 * The form is submitted by hand rather than through useActionState because the
 * uploads have to run between the action returning and the redirect.
 */
type Picked = { file: File; preview: string }

/**
 * The catalogue half of the form, held in React so a chosen suggestion can fill
 * it. Everything under "таны хувийн нөхцөл" stays uncontrolled — it describes
 * this copy, and nothing else's description should ever write to it.
 */
type BookFields = {
  title: string
  author: string
  publisher: string
  language: string
  publishedYear: string
  isbn: string
  pageCount: string
  weightG: string
  sizeNote: string
  description: string
}

const BLANK: BookFields = {
  title: '', author: '', publisher: '', language: 'mn', publishedYear: '',
  isbn: '', pageCount: '', weightG: '', sizeNote: '', description: '',
}

export function AddBookForm() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<ActionState>({ ok: false })
  const [picked, setPicked] = useState<Picked[]>([])
  const [phase, setPhase] = useState<'idle' | 'saving' | 'uploading'>('idle')
  const [progress, setProgress] = useState(0)
  const [uploadIndex, setUploadIndex] = useState(0)
  const [imageError, setImageError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [fields, setFields] = useState<BookFields>(BLANK)
  const [categories, setCategories] = useState<string[]>([])
  /**
   * The catalogue row whose description is on screen. Kept even while the reader
   * edits: the database compares the submission against the row and reuses it
   * only if it still matches, so leaving this in place means reverting an edit
   * quietly rejoins the shared row instead of stranding a near-duplicate.
   */
  const [adopted, setAdopted] = useState<CatalogueMatch | null>(null)
  /** Remounts the picker so a chosen suggestion's headings actually appear. */
  const [pickerKey, setPickerKey] = useState(0)

  const set = <K extends keyof BookFields>(key: K, v: BookFields[K]) =>
    setFields((f) => ({ ...f, [key]: v }))

  function adopt(match: CatalogueMatch) {
    setFields({
      title: match.title,
      author: match.author ?? '',
      publisher: match.publisher ?? '',
      language: match.language ?? 'other',
      publishedYear: match.publishedYear ? String(match.publishedYear) : '',
      isbn: match.isbn ?? '',
      pageCount: match.pageCount ? String(match.pageCount) : '',
      weightG: match.weightG ? String(match.weightG) : '',
      sizeNote: match.sizeNote ?? '',
      description: match.description ?? '',
    })
    setCategories(match.categories)
    setAdopted(match)
    setPickerKey((k) => k + 1)
  }

  function unadopt() {
    setAdopted(null)
    setCategories([])
    setFields({ ...BLANK, title: fields.title })
    setPickerKey((k) => k + 1)
  }

  const busy = phase !== 'idle'
  const errors = !state.ok ? state.errors : undefined
  const remaining = IMAGE_MAX_COUNT - picked.length

  // Object URLs are a browser resource, not React state; release them when the
  // component goes away so a long session does not leak every preview.
  useEffect(() => {
    return () => picked.forEach((p) => URL.revokeObjectURL(p.preview))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addFiles(files: File[]) {
    setImageError(null)
    setPreparing(true)
    const accepted: Picked[] = []
    try {
    for (const file of files.slice(0, remaining)) {
      // Resized here rather than at submit time, so the preview is the same
      // image that will be uploaded and a bad file is reported while the reader
      // is still looking at the picker.
      const prepared = await prepareImage(file)
      if (!prepared.ok) {
        setImageError(`${file.name}: ${prepared.message}`)
        continue
      }
      accepted.push({ file: prepared.file, preview: URL.createObjectURL(prepared.file) })
    }
    } finally {
      // Without this a thrown decoder leaves the picker disabled for good.
      setPreparing(false)
    }
    if (accepted.length > 0) setPicked((prev) => [...prev, ...accepted])
  }

  function removeAt(index: number) {
    setPicked((prev) => {
      const target = prev[index]
      if (target) URL.revokeObjectURL(target.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    // Guarded here as well as on the button: a form can still be submitted by
    // pressing Enter in a text field.
    if (picked.length === 0) {
      setImageError('Номынхоо нэг зургийг нэмнэ үү — зураггүй ном солилцоонд хүлээн авахад хүндрэлтэй.')
      return
    }

    setImageError(null)
    setPhase('saving')
    const formData = new FormData(event.currentTarget)
    const result = await createBookAction({ ok: false }, formData)

    if (!result.ok || !result.bookId || !result.copyId) {
      setState(result)
      setPhase('idle')
      return
    }

    // The book exists from here on. A failed photo is reported but never undoes
    // the registration — the reader can add photos again from the copy page.
    const failures: string[] = []
    if (picked.length > 0) {
      setPhase('uploading')
      for (let i = 0; i < picked.length; i++) {
        setUploadIndex(i + 1)
        setProgress(0)
        const res = await uploadImageToCopy(result.copyId, picked[i].file, setProgress)
        if (!res.ok) failures.push(`${picked[i].file.name}: ${res.message}`)
      }
    }

    if (failures.length > 0) {
      setImageError(
        `Ном бүртгэгдсэн. Зарим зураг орсонгүй — ${failures[0]}. Номынхоо хуудаснаас дахин нэмж болно.`
      )
      setPhase('idle')
      return
    }

    // Back to wherever the reader came from — the shelf, the feed, their
    // profile. history.length is 1 only when this page was opened directly,
    // in which case there is nothing to go back to.
    if (window.history.length > 1) router.back()
    else router.replace(`/books/${result.copyId}`)
  }

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      {!state.ok && <FormMessage message={state.message} />}

      <fieldset className={styles.group} disabled={busy}>
        <legend className={styles.legend}>1 · Номын мэдээлэл</legend>

        <div className={styles.dropzone} data-active={picked.length > 0}>
          <span className={styles.dropIcon} aria-hidden="true" />
          <span className={styles.dropTitle}>Өөрийн номныхоо зургийг нэмээрэй</span>
          <span className={styles.dropHint}>
            Заавал · утас, компьютерээс · хамгийн ихдээ {IMAGE_MAX_COUNT} · автоматаар
            жижигрүүлнэ
          </span>
          {/* A label, not a button calling input.click(): several mobile
              browsers refuse to open the picker for an input hidden with
              display:none, which is what `hidden` does. The input stays in the
              layout and is hidden visually instead, and the label opens it the
              way the platform intends — no JavaScript in the path at all. */}
          <input
            id="book-photos"
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className={styles.fileInput}
            onChange={async (e) => {
              await addFiles(Array.from(e.target.files ?? []))
              if (inputRef.current) inputRef.current.value = ''
            }}
          />
          <label
            htmlFor="book-photos"
            className={styles.dropButton}
            data-disabled={busy || preparing || remaining <= 0}
          >
            {preparing
              ? 'Зураг бэлдэж байна…'
              : remaining > 0
                ? `Зураг сонгох (${remaining} үлдсэн)`
                : 'Хязгаарт хүрсэн'}
          </label>
        </div>

        {picked.length > 0 && (
          <ul className={styles.thumbs}>
            {picked.map((p, i) => (
              <li key={p.preview} className={styles.thumb}>
                {/* Local object URL, so next/image would only add indirection. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt="" />
                {i === 0 && <span className={styles.thumbFirst}>Үндсэн</span>}
                <button
                  type="button"
                  className={styles.thumbRemove}
                  aria-label={`${p.file.name}-ыг хасах`}
                  disabled={busy}
                  onClick={() => removeAt(i)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {phase === 'uploading' && (
          <>
            <p className={styles.uploadStatus}>
              Зураг байршуулж байна: {uploadIndex}/{picked.length} — {progress}%
            </p>
            <div className={styles.progress}>
              <div className={styles.progressBar} style={{ width: `${progress}%` }} />
            </div>
          </>
        )}

        {imageError && <p className={styles.error}>{imageError}</p>}

        {/* The catalogue row this description came from, if any. The database
            treats it as a hint: it attaches the copy to that row only while the
            submission still matches, and quietly forks a private row when it
            does not. So an edit needs no bookkeeping here. */}
        {adopted && <input type="hidden" name="bookId" value={adopted.bookId} />}

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="title">
            Номын нэр
          </label>
          <CatalogueField
            value={fields.title}
            onChange={(v) => set('title', v)}
            onAdopt={adopt}
            disabled={busy}
            invalid={Boolean(errors?.title)}
          />
          <span className={formStyles.hint}>
            Бичиж байхад манай санд байгаа ижил номыг санал болгоно — сонговол доорх
            мэдээлэл автоматаар дүүрнэ.
          </span>
          <FieldError errors={errors?.title} />
        </div>

        {adopted && (
          <p className={styles.adopted}>
            <span>
              <strong>{adopted.title}</strong>-ын мэдээллийг хуулж авлаа
              {adopted.copyCount > 0 ? ` · ${adopted.copyCount} хүн ижил номыг бүртгэсэн` : ''}.
              Ямар ч хэсгийг чөлөөтэй засаж болно.
            </span>
            <button type="button" onClick={unadopt} disabled={busy}>
              Цэвэрлэх
            </button>
          </p>
        )}

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="author">
              Зохиогч
            </label>
            <input
              className={formStyles.input}
              id="author"
              name="author"
              type="text"
              maxLength={200}
              value={fields.author}
              onChange={(e) => set('author', e.target.value)}
            />
            <FieldError errors={errors?.author} />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="publisher">
              Хэвлэлийн газар
              <span className={formStyles.optional}>заавал биш</span>
            </label>
            <input
              className={formStyles.input}
              id="publisher"
              name="publisher"
              type="text"
              maxLength={200}
              value={fields.publisher}
              onChange={(e) => set('publisher', e.target.value)}
            />
          </div>
        </div>

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="language">
              Хэл
            </label>
            <select
              className={formStyles.select}
              id="language"
              name="language"
              value={fields.language}
              onChange={(e) => set('language', e.target.value)}
            >
              <option value="mn">Монгол</option>
              <option value="en">Англи</option>
              <option value="ru">Орос</option>
              <option value="other">Бусад</option>
            </select>
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="publishedYear">
              Хэвлэсэн он
              <span className={formStyles.optional}>заавал биш</span>
            </label>
            <input
              className={formStyles.input}
              id="publishedYear"
              name="publishedYear"
              type="number"
              min={1000}
              max={2027}
              placeholder="2019"
              value={fields.publishedYear}
              onChange={(e) => set('publishedYear', e.target.value)}
            />
            <FieldError errors={errors?.publishedYear} />
          </div>
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="isbn">
            ISBN
            <span className={formStyles.optional}>заавал биш</span>
          </label>
          <input
            className={formStyles.input}
            id="isbn"
            name="isbn"
            type="text"
            placeholder="978-99929-0-123-4"
            inputMode="numeric"
            value={fields.isbn}
            onChange={(e) => set('isbn', e.target.value)}
          />
          <span className={formStyles.hint}>Хайлтад тусалдаг нэмэлт мэдээлэл.</span>
          <FieldError errors={errors?.isbn} />
        </div>


        <div className={formStyles.field}>
          <span className={formStyles.label}>
            Ангилал
            <span className={formStyles.optional}>заавал биш</span>
          </span>
          <CategoryPicker key={pickerKey} initial={categories as never} disabled={busy} />
          <FieldError errors={errors?.categories} />
        </div>

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="pageCount">
              Нүүрний тоо
              <span className={formStyles.optional}>заавал биш</span>
            </label>
            <input
              className={formStyles.input}
              id="pageCount"
              name="pageCount"
              type="number"
              min={1}
              max={20000}
              inputMode="numeric"
              placeholder="320"
              value={fields.pageCount}
              onChange={(e) => set('pageCount', e.target.value)}
            />
            <FieldError errors={errors?.pageCount} />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="weightG">
              Жин (грамм)
              <span className={formStyles.optional}>заавал биш</span>
            </label>
            <input
              className={formStyles.input}
              id="weightG"
              name="weightG"
              type="number"
              min={1}
              max={20000}
              inputMode="numeric"
              placeholder="450"
              value={fields.weightG}
              onChange={(e) => set('weightG', e.target.value)}
            />
            <FieldError errors={errors?.weightG} />
          </div>
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="sizeNote">
            Хэмжээ
            <span className={formStyles.optional}>заавал биш</span>
          </label>
          <input
            className={formStyles.input}
            id="sizeNote"
            name="sizeNote"
            type="text"
            maxLength={40}
            placeholder="14×20 см"
            value={fields.sizeNote}
            onChange={(e) => set('sizeNote', e.target.value)}
          />
          <FieldError errors={errors?.sizeNote} />
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="description">
            Тайлбар
            <span className={formStyles.optional}>заавал биш</span>
          </label>
          <textarea
            className={formStyles.textarea}
            id="description"
            name="description"
            maxLength={8000}
            placeholder="Номын товч агуулга…"
            value={fields.description}
            onChange={(e) => set('description', e.target.value)}
          />
          <FieldError errors={errors?.description} />
        </div>
      </fieldset>

      <fieldset className={styles.group} disabled={busy}>
        <legend className={styles.legend}>2 · Таны хувийн нөхцөл</legend>

        <div className={styles.conditions}>
          {BOOK_CONDITION.map((c, i) => (
            <label key={c} className={styles.condition}>
              <input type="radio" name="condition" value={c} defaultChecked={i === 2} />
              <span>{CONDITION_LABEL[c]}</span>
            </label>
          ))}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="conditionNote">
            Нөхцөлийн тайлбар
            <span className={formStyles.optional}>заавал биш</span>
          </label>
          <textarea
            className={formStyles.textarea}
            id="conditionNote"
            name="conditionNote"
            maxLength={1000}
            placeholder="Жишээ: Хавтас бага зэрэг элэгдэлтэй, дотор нь цэвэрхэн."
          />
          <FieldError errors={errors?.conditionNote} />
        </div>
      </fieldset>

      <div className={styles.actions}>
        {picked.length === 0 && (
          <span className={styles.needPhoto}>Нийтлэхийн тулд дор хаяж нэг зураг нэмнэ үү.</span>
        )}
        <button
          className={formStyles.submit}
          type="submit"
          disabled={busy || picked.length === 0}
        >
          {phase === 'saving'
            ? 'Хадгалж байна…'
            : phase === 'uploading'
              ? 'Зураг байршуулж байна…'
              : 'Нийтлэх'}
        </button>
      </div>
    </form>
  )
}

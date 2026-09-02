'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import { ImageUploader } from '@/features/images/ImageUploader'
import { BOOK_CONDITION, CONDITION_LABEL } from '@/types/domain'
import { createBookAction, type ActionState } from './actions'
import formStyles from '@/components/forms.module.css'
import styles from '@/app/books/new/page.module.css'

const initial: ActionState = { ok: false }

export function AddBookForm() {
  const [state, formAction, pending] = useActionState(createBookAction, initial)
  const errors = !state.ok ? state.errors : undefined

  // The book + copy now exist; prompt the owner to attach photos.
  if (state.ok && state.copyId) {
    return (
      <div className={styles.form}>
        <div className={styles.group}>
          <legend className={styles.legend}>3 · Зураг нэмэх (заавал биш)</legend>
          <p className={styles.imageHint}>
            Ном бүртгэгдсэн. Одоо эсвэл дараа ч зураг нэмж болно.
          </p>
          <ImageUploader copyId={state.copyId} images={[]} />
        </div>

        <div className={styles.actions}>
          <Link className={formStyles.submit} href={`/books/${state.bookId}`}>
            Дуусгах
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form action={formAction} className={styles.form}>
      {!state.ok && <FormMessage message={state.message} />}

      <fieldset className={styles.group} disabled={pending}>
        <legend className={styles.legend}>1 · Номын мэдээлэл</legend>

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
          />
          <span className={formStyles.hint}>
            Ижил ISBN-тэй ном аль хэдийн байвал таны хувь түүн дээр нэмэгдэнэ.
          </span>
          <FieldError errors={errors?.isbn} />
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="title">
            Номын нэр
          </label>
          <input
            className={formStyles.input}
            id="title"
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
            <label className={formStyles.label} htmlFor="author">
              Зохиогч
            </label>
            <input className={formStyles.input} id="author" name="author" type="text" maxLength={200} />
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
            />
          </div>
        </div>

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="language">
              Хэл
            </label>
            <select className={formStyles.select} id="language" name="language" defaultValue="mn">
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
            />
            <FieldError errors={errors?.publishedYear} />
          </div>
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
          />
          <FieldError errors={errors?.description} />
        </div>
      </fieldset>

      <fieldset className={styles.group} disabled={pending}>
        <legend className={styles.legend}>2 · Номын нөхцөл</legend>

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
        <button className={formStyles.submit} type="submit" disabled={pending}>
          {pending ? 'Хадгалж байна…' : 'Нийтлэх'}
        </button>
      </div>
    </form>
  )
}

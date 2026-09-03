'use client'

import { useActionState, useEffect, useRef } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import { createRequestAction, type RequestState } from './actions'
import formStyles from '@/components/forms.module.css'
import styles from './MyRequestsPanel.module.css'

const initial: RequestState = { ok: false }

/** Post a request. Free text: there is no catalogue to pick from. */
export function AddRequestForm() {
  const [state, formAction, pending] = useActionState(createRequestAction, initial)
  const errors = !state.ok ? state.errors : undefined
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className={styles.addForm}>
      {!state.ok && <FormMessage message={state.message} />}
      {state.ok && <p className={styles.posted}>✓ Хүсэлт нийтлэгдлээ.</p>}

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="req-title">
          Ямар ном хайж байна?
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

      <div className={styles.addActions}>
        <button className={formStyles.submit} type="submit" disabled={pending}>
          {pending ? 'Нийтэлж байна…' : 'Хүсэлт нийтлэх'}
        </button>
      </div>
    </form>
  )
}

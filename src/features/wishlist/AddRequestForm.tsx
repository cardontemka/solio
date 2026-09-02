'use client'

import { useActionState } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import { createRequestAction, type WishState } from './actions'
import formStyles from '@/components/forms.module.css'
import styles from '@/app/wishlist/page.module.css'

const initial: WishState = { ok: false }

export function AddRequestForm() {
  const [state, formAction, pending] = useActionState(createRequestAction, initial)
  const errors = !state.ok ? state.errors : undefined

  return (
    <form action={formAction} key={state.ok ? 'sent' : 'idle'}>
      {!state.ok && <FormMessage message={state.message} />}
      {state.ok && <p className={styles.sent}>✓ Жагсаалтад нэмэгдлээ.</p>}

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="wTitle">Номын нэр</label>
        <input className={formStyles.input} id="wTitle" name="title" type="text"
               required maxLength={300} placeholder="Хүсэж буй номын нэр" />
        <FieldError errors={errors?.title} />
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="wAuthor">
          Зохиогч <span className={formStyles.optional}>заавал биш</span>
        </label>
        <input className={formStyles.input} id="wAuthor" name="author" type="text" maxLength={200} />
        <FieldError errors={errors?.author} />
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="wIsbn">
          ISBN <span className={formStyles.optional}>заавал биш</span>
        </label>
        <input className={formStyles.input} id="wIsbn" name="isbn" type="text"
               maxLength={32} inputMode="numeric" placeholder="978-…" />
        <span className={formStyles.hint}>ISBN өгвөл тааруулалт илүү нарийн болно.</span>
        <FieldError errors={errors?.isbn} />
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="wNote">
          Тэмдэглэл <span className={formStyles.optional}>заавал биш</span>
        </label>
        <textarea className={formStyles.textarea} id="wNote" name="note" maxLength={500}
                  rows={2} placeholder="Жишээ: Аль ч хэвлэл болно." />
      </div>

      <button className={formStyles.submit} type="submit" disabled={pending}>
        {pending ? 'Нэмж байна…' : 'Жагсаалтад нэмэх'}
      </button>
    </form>
  )
}

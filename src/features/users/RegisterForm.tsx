'use client'

import { useActionState } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import { registerAction, type AuthState } from './actions'
import styles from '@/components/forms.module.css'

const initial: AuthState = { ok: false }

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, initial)
  const errors = !state.ok ? state.errors : undefined

  return (
    <form action={formAction}>
      {!state.ok && <FormMessage message={state.message} />}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="displayName">
          Нэр
        </label>
        <input
          className={styles.input}
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          required
          placeholder="Таны нэр"
        />
        <FieldError errors={errors?.displayName} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="username">
          Хэрэглэгчийн нэр
        </label>
        <input
          className={styles.input}
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          pattern="[a-z0-9_]{3,24}"
          placeholder="altan"
        />
        <span className={styles.hint}>Жижиг үсэг, тоо, доогуур зураас. 3–24 тэмдэгт.</span>
        <FieldError errors={errors?.username} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="email">
          Email хаяг
        </label>
        <input
          className={styles.input}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="tanii@email.mn"
        />
        <span className={styles.hint}>Email тань бусад хэрэглэгчид харагдахгүй.</span>
        <FieldError errors={errors?.email} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">
          Нууц үг
        </label>
        <input
          className={styles.input}
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Хамгийн багадаа 8 тэмдэгт"
        />
        <FieldError errors={errors?.password} />
      </div>

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? 'Үүсгэж байна…' : 'Данс үүсгэх'}
      </button>
    </form>
  )
}

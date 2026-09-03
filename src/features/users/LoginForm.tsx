'use client'

import { useActionState, useState } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import { loginAction, type AuthState } from './actions'
import styles from '@/components/forms.module.css'

const initial: AuthState = { ok: false }

/**
 * The fields are controlled rather than left to the DOM. React resets an
 * uncontrolled form after a form action runs, so a rejected login used to wipe
 * both boxes and make the reader retype an address that was never the problem.
 */
export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initial)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const errors = !state.ok ? state.errors : undefined

  return (
    <form action={formAction}>
      {!state.ok && <FormMessage message={state.message} />}
      {next && <input type="hidden" name="next" value={next} />}

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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(errors?.email)}
        />
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
          autoComplete="current-password"
          required
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(errors?.password)}
        />
        <FieldError errors={errors?.password} />
      </div>

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? 'Нэвтэрч байна…' : 'Нэвтрэх'}
      </button>
    </form>
  )
}

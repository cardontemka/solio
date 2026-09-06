'use client'

import { useActionState, useState } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import { PasswordField } from '@/components/PasswordField'
import { registerAction, type AuthState } from './actions'
import { formatCooldown, useRetryCooldown } from './useRetryCooldown'
import styles from '@/components/forms.module.css'

const initial: AuthState = { ok: false }

/**
 * Controlled fields, because React resets an uncontrolled form once a form
 * action returns: a rejected signup used to clear all four boxes, so fixing one
 * character meant retyping everything.
 *
 * The username box lowercases as you type, which is what anyone expects, but it
 * does not strip anything else: typing Cyrillic and watching the letters vanish
 * is more baffling than being told the rule. So the rule is told, live.
 */
export function RegisterForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(registerAction, initial)
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const cooldown = useRetryCooldown(state)
  const errors = !state.ok ? state.errors : undefined

  // Checked as you type so the reader learns the rule before submitting, not
  // after. The server checks the same thing — this is only feedback.
  const usernameProblem =
    username.length === 0
      ? null
      : !/^[a-z0-9_]*$/.test(username)
        ? 'Зөвхөн латин үсэг, тоо, доогуур зураас (_) байж болно. Кирилл үсэг, зай, тусгай тэмдэг болохгүй.'
        : username.length < 3
          ? `Хамгийн багадаа 3 тэмдэгт — дахиад ${3 - username.length} нэмнэ үү.`
          : null

  // Only complained about once the second box has caught up in length: saying
  // "they do not match" after the first keystroke is noise, not help.
  const confirmProblem =
    confirm.length === 0 || password.startsWith(confirm)
      ? null
      : 'Хоёр нууц үг таарахгүй байна.'

  if (state.ok && state.pendingConfirmation) {
    return (
      <p className={styles.pending}>
        <strong>Бүртгэл үүслээ.</strong>
        Оруулсан хаяг руу баталгаажуулах холбоос илгээлээ. Тэр холбоос дээр дарсны дараа
        нэвтрэх боломжтой болно. Захидал ирээгүй бол spam хавтсаа шалгана уу.
      </p>
    )
  }

  return (
    <form action={formAction}>
      {next && <input type="hidden" name="next" value={next} />}
      {!state.ok && <FormMessage message={state.message} />}
      {cooldown > 0 && (
        <p className={styles.cooldown} role="status" aria-live="polite">
          Дахин оролдох хүртэл <strong>{formatCooldown(cooldown)}</strong>
        </p>
      )}

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
          maxLength={60}
          placeholder="Таны нэр"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          aria-invalid={Boolean(errors?.displayName)}
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
          maxLength={24}
          placeholder="altan"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          aria-invalid={Boolean(errors?.username) || Boolean(usernameProblem)}
        />
        <span className={styles.hint}>
          Латин үсэг, тоо, доогуур зураас. 3–24 тэмдэгт. Нийтийн хуудсанд тань ингэж
          харагдана: solio.mn/u/{/^[a-z0-9_]{3,}$/.test(username) ? username : 'altan'}
        </span>
        {usernameProblem ? (
          <p className={styles.error}>{usernameProblem}</p>
        ) : (
          <FieldError errors={errors?.username} />
        )}
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(errors?.email)}
        />
        <span className={styles.hint}>Email тань бусад хэрэглэгчид харагдахгүй.</span>
        <FieldError errors={errors?.email} />
      </div>

      <PasswordField
        label="Нууц үг"
        id="password"
        name="password"
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="Хамгийн багадаа 8 тэмдэгт"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={Boolean(errors?.password)}
        hint={
          password.length > 0 && password.length < 8
            ? `Дахиад ${8 - password.length} тэмдэгт нэмнэ үү.`
            : 'Хамгийн багадаа 8 тэмдэгт.'
        }
      >
        <FieldError errors={errors?.password} />
      </PasswordField>

      <PasswordField
        label="Нууц үг давтах"
        id="passwordConfirm"
        name="passwordConfirm"
        autoComplete="new-password"
        required
        placeholder="Дахиад нэг удаа"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        aria-invalid={Boolean(errors?.passwordConfirm) || Boolean(confirmProblem)}
      >
        {confirmProblem ? (
          <p className={styles.error}>{confirmProblem}</p>
        ) : (
          <FieldError errors={errors?.passwordConfirm} />
        )}
      </PasswordField>

      <button className={styles.submit} type="submit" disabled={pending || cooldown > 0}>
        {pending
          ? 'Үүсгэж байна…'
          : cooldown > 0
            ? `Хүлээнэ үү — ${formatCooldown(cooldown)}`
            : 'Хаяг үүсгэх'}
      </button>
    </form>
  )
}

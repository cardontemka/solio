'use client'

import { useActionState, useState } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import { PasswordField } from '@/components/PasswordField'
import { StoragePointFields } from '@/features/storage/StoragePointFields'
import { registerAction, type AuthState } from './actions'
import { formatCooldown, useRetryCooldown } from './useRetryCooldown'
import styles from '@/components/forms.module.css'

const initial: AuthState = { ok: false }

/**
 * Controlled fields, because React resets an uncontrolled form once a form
 * action returns: a rejected signup used to clear the boxes, so fixing one
 * character meant retyping everything.
 *
 * There is no username box. The rule it had to explain — lowercase Latin, no
 * spaces, 3 to 24 characters — is a database constraint, not something a reader
 * signing up has any reason to care about, and Cyrillic names could not satisfy
 * it at all. The signup trigger derives one from the address instead, and
 * anybody who wants a different one changes it in settings, where the URL it
 * appears in is right there on the page.
 *
 * A café signs up here too. It is the same account with a page of premises
 * attached, so it is the same form with a block added rather than a second one
 * to keep in step — and the name box disappears, because a venue is named by
 * the box that asks for its name.
 */
export function RegisterForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(registerAction, initial)
  const [accountType, setAccountType] = useState<'person' | 'storage_point'>('person')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const cooldown = useRetryCooldown(state)
  const errors = !state.ok ? state.errors : undefined
  const isPoint = accountType === 'storage_point'

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
      <input type="hidden" name="accountType" value={accountType} />

      <div className={styles.choice} role="group" aria-label="Хаягийн төрөл">
        <button
          type="button"
          className={styles.choiceOption}
          aria-pressed={!isPoint}
          onClick={() => setAccountType('person')}
        >
          Хувь хүн
          <span className={styles.choiceNote}>Ном, пянзаа солилцоно</span>
        </button>
        <button
          type="button"
          className={styles.choiceOption}
          aria-pressed={isPoint}
          onClick={() => setAccountType('storage_point')}
        >
          Хадгалах цэг
          <span className={styles.choiceNote}>Кафе, номын сан, дэлгүүр</span>
        </button>
      </div>

      {!state.ok && <FormMessage message={state.message} />}
      {cooldown > 0 && (
        <p className={styles.cooldown} role="status" aria-live="polite">
          Дахин оролдох хүртэл <strong>{formatCooldown(cooldown)}</strong>
        </p>
      )}

      {!isPoint && (
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
        <span className={styles.hint}>
          Бусдад ингэж харагдана. Хаягийн богино нэр (solio.mn/u/…) автоматаар үүсэх ба
          Тохиргооноос өөрчилж болно.
        </span>
        <FieldError errors={errors?.displayName} />
      </div>
      )}

      {isPoint && (
        <div className={styles.group}>
          <h2 className={styles.groupTitle}>Хадгалах цэгийн мэдээлэл</h2>
          <p className={styles.groupNote}>
            Ном хадгалуулах хүн энэ мэдээллээр тань дээр очно. Хаяг, утас, ажиллах цаг
            заавал бөглөнө.
          </p>
          <StoragePointFields errors={errors} disabled={pending} />
        </div>
      )}

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
            : isPoint
              ? 'Хадгалах цэг бүртгүүлэх'
              : 'Хаяг үүсгэх'}
      </button>
    </form>
  )
}

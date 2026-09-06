'use client'

import { useActionState, useState } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import { PasswordField } from '@/components/PasswordField'
import { LockIcon } from '@/components/Icons'
import { changePasswordAction, type PasswordState } from '@/features/users/actions'
import { formatCooldown, useRetryCooldown } from '@/features/users/useRetryCooldown'
import formStyles from '@/components/forms.module.css'
import styles from './page.module.css'

const initial: PasswordState = { ok: false }

/**
 * Password change, or a first password for someone who arrived through Google.
 *
 * The boxes are left uncontrolled, unlike the login and signup forms. React
 * empties a form once its action returns, and for a password that is the right
 * outcome — nothing is left on screen for the next person at the desk. Trying to
 * hold the text across a refusal instead means fighting that reset: a controlled
 * input whose state did not change is not re-synced after it, so the text
 * disappears from the screen while React still believes it is there, and the next
 * submit sends the ghost.
 *
 * So the reset is left alone, and the mismatch is caught here instead — the
 * button stays disabled while the two new passwords differ, which is the
 * rejection that would otherwise cost a full retype. `mirror` exists only to
 * drive that check and the character count; it is cleared alongside the boxes so
 * the two never disagree.
 */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, initial)
  const cooldown = useRetryCooldown(state)
  const errors = !state.ok ? state.errors : undefined

  const [mirror, setMirror] = useState({ next: '', confirm: '' })
  const [seen, setSeen] = useState(state)

  // Render-time adjustment, not an effect: useActionState hands back a new
  // object per submission, and an effect would commit once with the stale count.
  if (seen !== state) {
    setSeen(state)
    setMirror({ next: '', confirm: '' })
  }

  // Only complained about once the second box has had a chance to catch up —
  // warning after the first keystroke is noise, not help.
  const mismatch =
    mirror.confirm.length > 0 && !mirror.next.startsWith(mirror.confirm)
      ? 'Хоёр нууц үг таарахгүй байна.'
      : null
  const incomplete = mirror.next.length === 0 || mirror.confirm !== mirror.next

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <LockIcon size={17} />
        {hasPassword ? 'Нууц үг солих' : 'Нууц үг тохируулах'}
      </h2>
      <p className={styles.sectionNote}>
        {hasPassword
          ? 'Сольсны дараа бусад төхөөрөмж дээрх нэвтрэлт хүчингүй болно. Энэ төхөөрөмж хэвээр нэвтэрсэн байна.'
          : 'Та Google-ээр нэвтэрсэн байна. Нууц үг тохируулбал email хаяг, нууц үгээрээ ч нэвтэрч болно.'}
      </p>

      <form action={formAction} className={styles.form}>
        {state.ok && (
          <p className={styles.saved} role="status">
            Нууц үг {hasPassword ? 'солигдлоо' : 'тохирлоо'}.
          </p>
        )}
        {!state.ok && <FormMessage message={state.message} />}
        {cooldown > 0 && (
          <p className={formStyles.cooldown} role="status" aria-live="polite">
            Дахин оролдох хүртэл <strong>{formatCooldown(cooldown)}</strong>
          </p>
        )}

        {hasPassword && (
          <PasswordField
            label="Одоогийн нууц үг"
            id="current"
            name="current"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            aria-invalid={Boolean(errors?.current)}
          >
            <FieldError errors={errors?.current} />
          </PasswordField>
        )}

        <PasswordField
          label="Шинэ нууц үг"
          id="newPassword"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Хамгийн багадаа 8 тэмдэгт"
          onChange={(e) => setMirror((m) => ({ ...m, next: e.target.value }))}
          hint={
            mirror.next.length > 0 && mirror.next.length < 8
              ? `Дахиад ${8 - mirror.next.length} тэмдэгт нэмнэ үү.`
              : 'Хамгийн багадаа 8 тэмдэгт.'
          }
          aria-invalid={Boolean(errors?.password)}
        >
          <FieldError errors={errors?.password} />
        </PasswordField>

        <PasswordField
          label="Шинэ нууц үг давтах"
          id="newPasswordConfirm"
          name="passwordConfirm"
          autoComplete="new-password"
          required
          placeholder="Дахиад нэг удаа"
          onChange={(e) => setMirror((m) => ({ ...m, confirm: e.target.value }))}
          aria-invalid={Boolean(errors?.passwordConfirm) || Boolean(mismatch)}
        >
          {mismatch ? (
            <span className={formStyles.error}>{mismatch}</span>
          ) : (
            <FieldError errors={errors?.passwordConfirm} />
          )}
        </PasswordField>

        <div className={styles.actions}>
          <button
            className={formStyles.submit}
            type="submit"
            disabled={pending || cooldown > 0 || incomplete}
          >
            {pending ? 'Хадгалж байна…' : hasPassword ? 'Нууц үг солих' : 'Нууц үг тохируулах'}
          </button>
        </div>
      </form>
    </section>
  )
}

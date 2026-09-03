'use client'

import { useActionState } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import { updateProfileAction, type ProfileState } from '@/features/users/actions'
import formStyles from '@/components/forms.module.css'
import styles from './page.module.css'

const initial: ProfileState = { ok: false }

export function SettingsForm({
  username,
  displayName,
  bio,
  city,
}: {
  username: string
  displayName: string
  bio: string | null
  city: string | null
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, initial)
  const errors = !state.ok ? state.errors : undefined
  const current = state.ok ? state.username : username

  return (
    <form action={formAction} className={styles.form}>
      {!state.ok && <FormMessage message={state.message} />}
      {state.ok && <p className={styles.saved}>✓ Хадгалагдлаа.</p>}

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="displayName">
          Харагдах нэр
        </label>
        <input
          className={formStyles.input}
          id="displayName"
          name="displayName"
          type="text"
          required
          maxLength={60}
          defaultValue={displayName}
        />
        <FieldError errors={errors?.displayName} />
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="username">
          Хаяг (username)
        </label>
        <div className={styles.usernameRow}>
          <span className={styles.usernamePrefix}>solio.mn/u/</span>
          <input
            className={formStyles.input}
            id="username"
            name="username"
            type="text"
            required
            minLength={3}
            maxLength={24}
            pattern="[a-z0-9_]{3,24}"
            defaultValue={username}
          />
        </div>
        <span className={formStyles.hint}>
          Жижиг үсэг, тоо, доогуур зураас. Энэ нь таны нийтийн хуудасны хаяг —
          одоогоор <strong>/u/{current}</strong>.
        </span>
        <FieldError errors={errors?.username} />
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="city">
          Хот / Байршил
          <span className={formStyles.optional}>заавал биш</span>
        </label>
        <input
          className={formStyles.input}
          id="city"
          name="city"
          type="text"
          maxLength={60}
          defaultValue={city ?? ''}
          placeholder="Улаанбаатар"
        />
        <span className={formStyles.hint}>
          Номын картан дээр харагдана — солилцоо хийхэд ойр хүнээ олоход хэрэгтэй.
        </span>
        <FieldError errors={errors?.city} />
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="bio">
          Танилцуулга
          <span className={formStyles.optional}>заавал биш</span>
        </label>
        <textarea
          className={formStyles.textarea}
          id="bio"
          name="bio"
          maxLength={500}
          defaultValue={bio ?? ''}
          placeholder="Ямар номд дуртай, юу хайж байгаа…"
        />
        <FieldError errors={errors?.bio} />
      </div>

      <div className={styles.actions}>
        <button className={formStyles.submit} type="submit" disabled={pending}>
          {pending ? 'Хадгалж байна…' : 'Хадгалах'}
        </button>
      </div>
    </form>
  )
}

'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { FormMessage } from '@/components/FormError'
import { CoverPicker } from '@/features/storage/CoverPicker'
import { StoragePointFields } from '@/features/storage/StoragePointFields'
import { updateStoragePointAction, type StorageState } from '@/features/storage/actions'
import type { StoragePoint } from '@/types/domain'
import formStyles from '@/components/forms.module.css'
import styles from './page.module.css'

const initial: StorageState = { ok: false }

/**
 * A venue's own details, on its settings page.
 *
 * The same block of boxes as the signup form — one component, so a field can
 * never be asked for in one place and missing in the other — with a link to
 * what the result looks like from outside, because that is the thing these
 * details are for.
 */
export function StoragePointForm({ point }: { point: StoragePoint }) {
  const [state, formAction, pending] = useActionState(updateStoragePointAction, initial)
  const errors = !state.ok ? state.errors : undefined

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Хадгалах цэгийн мэдээлэл</h2>
      <p className={styles.sectionNote}>
        Ном хадгалуулах хүн энэ мэдээллээр тань дээр очно.{' '}
        <Link href={`/u/${point.username}`} className={styles.viewLink}>
          Гаднаас нь харах
        </Link>
      </p>

      {/* Outside the form on purpose: it uploads on its own, and a picture
          chosen but not saved because the form below failed validation would be
          the wrong kind of surprise. */}
      <CoverPicker initialUrl={point.coverUrl} />

      <form action={formAction} className={styles.form}>
        {state.ok && (
          <p className={styles.saved} role="status">
            Мэдээлэл хадгалагдлаа.
          </p>
        )}
        {!state.ok && <FormMessage message={state.message} />}

        <StoragePointFields point={point} errors={errors} disabled={pending} />

        <div className={styles.actions}>
          <button className={formStyles.submit} type="submit" disabled={pending}>
            {pending ? 'Хадгалж байна…' : 'Хадгалах'}
          </button>
        </div>
      </form>
    </section>
  )
}

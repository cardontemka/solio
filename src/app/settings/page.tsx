import { PageHeader } from '@/components/ui'
import { getStoragePointFor } from '@/features/storage/queries'
import { requireUser } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { SettingsForm } from './SettingsForm'
import { StoragePointForm } from './StoragePointForm'
import { PasswordForm } from './PasswordForm'
import styles from './page.module.css'

export const metadata = {
  title: 'Профайл тохиргоо',
  robots: { index: false, follow: false },
}

export default async function SettingsPage() {
  const me = await requireUser()
  // bio is not on SessionUser — only this page needs it.
  const supabase = await createClient()
  const { data } = await supabase.from('profiles').select('bio').eq('id', me.id).single()

  // Someone who only ever signed in with Google has no password to change —
  // the form sets a first one for them and skips asking for the old one.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const hasPassword = (user?.identities ?? []).some((i) => i.provider === 'email')

  // Only a venue has premises to edit. Asked for by account type rather than by
  // trying the query on everybody: an ordinary reader has no row here and never
  // needs the round trip.
  const point =
    me.accountType === 'storage_point' ? await getStoragePointFor(me.id, me.username) : null

  return (
    <div className="container">
      <div className={styles.shell}>
        <PageHeader
          title="Профайл"
          subtitle="Нийтэд харагдах нэр, хэрэглэгчийн нэр, байршил, нууц үгээ өөрчилнө."
        />
        <SettingsForm
          username={me.username}
          displayName={me.displayName}
          bio={data?.bio ?? null}
          city={me.city}
          avatarUrl={me.avatarUrl}
        />
        {point && <StoragePointForm point={point} />}
        <PasswordForm hasPassword={hasPassword} />
      </div>
    </div>
  )
}

import { PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { SettingsForm } from './SettingsForm'
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

  return (
    <div className="container">
      <div className={styles.shell}>
        <PageHeader
          title="Профайл"
          subtitle="Нийтэд харагдах нэр, хэрэглэгчийн нэр, байршлаа өөрчилнө."
        />
        <SettingsForm
          username={me.username}
          displayName={me.displayName}
          bio={data?.bio ?? null}
          city={me.city}
          avatarUrl={me.avatarUrl}
        />
      </div>
    </div>
  )
}

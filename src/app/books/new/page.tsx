import { AddBookForm } from '@/features/books/AddBookForm'
import { requireUser } from '@/lib/auth/dal'
import { PageHeader } from '@/components/ui'
import styles from './page.module.css'

export const metadata = {
  title: 'Ном, пянз нэмэх',
  robots: { index: false, follow: false },
}

export default async function AddBookPage() {
  // Page-level gate for the UI. The Server Action re-checks independently —
  // this does not protect it.
  await requireUser()

  return (
    <div className="container">
      <div className={styles.shell}>
        <PageHeader
          title="Номоо нэмэх"
          subtitle="Гартаа байгаа бодит номоо эсвэл пянзаа бүртгэнэ."
        />
        <AddBookForm />
      </div>
    </div>
  )
}

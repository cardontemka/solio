import { AddTabs } from '@/features/books/AddTabs'
import { requireUser } from '@/lib/auth/dal'
import { PageHeader } from '@/components/ui'
import styles from './page.module.css'

export const metadata = {
  title: 'Нэмэх',
  robots: { index: false, follow: false },
}

export default async function AddBookPage() {
  // Page-level gate for the UI. The Server Action re-checks independently —
  // this does not protect it.
  await requireUser()

  return (
    <div className="container">
      <div className={styles.shell}>
        {/* Neither half of this page is about books in particular any more —
            records were the first thing to break that wording, and whatever
            comes third would break it again. */}
        <PageHeader title="Нэмэх" />
        <AddTabs />
      </div>
    </div>
  )
}

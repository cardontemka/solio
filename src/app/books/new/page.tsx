import { AddBookForm } from '@/features/books/AddBookForm'
import { requireUser } from '@/lib/auth/dal'
import { NotWiredNote, PageHeader } from '@/components/ui'
import styles from './page.module.css'

export const metadata = {
  title: 'Ном нэмэх',
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
          title="Ном нэмэх"
          subtitle="Өөрийн эзэмшдэг бодит номоо бүртгэж, солилцоонд нээлттэй болгоно."
        />
        <AddBookForm />
        <NotWiredNote>
          Зураг байршуулах нь Cloudflare R2-той хараахан холбогдоогүй тул энэ хувилбарт
          зурагны алхам байхгүй байна.
        </NotWiredNote>
      </div>
    </div>
  )
}

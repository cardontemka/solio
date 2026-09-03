import { EmptyState, PageHeader } from '@/components/ui'
import { AddRequestForm } from '@/features/requests/AddRequestForm'
import { RequestList } from '@/features/requests/RequestCard'
import { getRequestFeed } from '@/features/requests/queries'
import { getSessionUser } from '@/lib/auth/dal'
import styles from './page.module.css'

export const metadata = {
  title: 'Ном хүсэх',
  description: 'Хэрэглэгчид хайж байгаа номнууд. Тухайн ном байвал доор нь хариу бичээрэй.',
}

export default async function RequestsPage() {
  const me = await getSessionUser()
  const requests = await getRequestFeed(me?.id ?? null, { limit: 40 })

  return (
    <div className="container">
      <PageHeader
        title="Ном хүсэх"
        subtitle="Хэн ямар ном хайж байна. Тэр ном танд байвал доор нь хариу бичээрэй."
      />

      <div className={styles.layout}>
        <div className={styles.main}>
          {requests.length === 0 ? (
            <EmptyState
              title="Одоогоор хүсэлт байхгүй"
              description="Хайж буй номоо хамгийн эхэлж нийтлэх хүн та байж болно."
            />
          ) : (
            <RequestList requests={requests} />
          )}
        </div>

        <aside className={styles.aside}>
          {me ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Ном хүсэх</h2>
              <p className={styles.cardDesc}>
                Хайж буй номоо нийтэлнэ. Бусад хэрэглэгч доор нь хариу бичнэ.
              </p>
              <AddRequestForm />
            </div>
          ) : (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Ном хүсэх</h2>
              <p className={styles.cardDesc}>
                Хүсэлт нийтлэхийн тулд нэвтэрнэ үү.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

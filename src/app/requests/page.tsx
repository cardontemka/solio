import { EmptyState, PageHeader } from '@/components/ui'
import { AddRequestForm } from '@/features/requests/AddRequestForm'
import { RequestList } from '@/features/requests/RequestCard'
import { Pager } from '@/components/Pager'
import { getRequestFeed } from '@/features/requests/queries'
import { getSessionUser } from '@/lib/auth/dal'
import { pageFrom, splitPage } from '@/lib/paging'
import styles from './page.module.css'

export const metadata = {
  title: 'Сураглах',
  description: 'Хэрэглэгчид сураглаж байгаа ном, пянз. Танд байвал доор нь хариу бичээрэй.',
}

const PER_PAGE = 20

export default async function RequestsPage({ searchParams }: PageProps<'/requests'>) {
  const me = await getSessionUser()
  const params = await searchParams
  const info = pageFrom(params, PER_PAGE)
  const { items: requests, hasMore } = splitPage(
    await getRequestFeed(me?.id ?? null, { limit: info.fetch, offset: info.offset }),
    info
  )

  return (
    <div className="container">
      <PageHeader
        title="Сураглах"
        subtitle="Хэн юу сураглаж байна. Танд байвал доор нь хариу бичээрэй."
      />

      <div className={styles.layout}>
        <div className={styles.main}>
          {requests.length === 0 ? (
            <EmptyState
              title="Одоогоор сураглал байхгүй"
              description="Хамгийн эхэлж сураглал нийтлэх хүн та байж болно."
            />
          ) : (
            <RequestList requests={requests} />
          )}
          <Pager page={info.page} hasMore={hasMore} params={params} basePath="/requests" />
        </div>

        <aside className={styles.aside}>
          {me ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Сураглах</h2>
              <p className={styles.cardDesc}>
                Сураглаж буй ном, пянзаа нийтэлнэ. Бусад хэрэглэгч доор нь хариу бичнэ.
              </p>
              <AddRequestForm />
            </div>
          ) : (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Сураглах</h2>
              <p className={styles.cardDesc}>
                Сураглал нийтлэхийн тулд нэвтэрнэ үү.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

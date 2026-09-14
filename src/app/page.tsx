import { Suspense } from 'react'
import { BookGrid } from '@/components/BookCard'
import { EmptyState, Section } from '@/components/ui'
import { getListings } from '@/features/books/queries'
import { RequestList } from '@/features/requests/RequestCard'
import { getRequestFeed } from '@/features/requests/queries'
import { getSessionUser } from '@/lib/auth/dal'
import { ITEMS_LABEL_LOWER } from '@/types/domain'
import styles from './page.module.css'

async function RecentlyAdded() {
  const listings = await getListings({ limit: 6 })
  if (listings.length === 0) {
    return (
      <EmptyState
        title="Одоогоор юу ч байхгүй байна"
        description="Эхнийхийг нь нэмсэн хүн та байж болно."
      />
    )
  }
  // The first row is what a reader sees before scrolling, and one of those
  // covers is this page's LCP.
  return <BookGrid listings={listings} priorityCount={4} />
}

/**
 * Everything after the newest six. There is no popularity signal to rank by —
 * each listing is one person's single book — so this is honestly just "more".
 *
 * The Section lives inside the component, not around it: with only a handful of
 * listings on the site this returns nothing, and a heading over an empty space
 * reads as something failing to load.
 */
async function MoreListings() {
  const listings = await getListings({ limit: 12, offset: 6 })
  if (listings.length === 0) return null
  return (
    <Section
      title={`Бусад ${ITEMS_LABEL_LOWER}`}
      description="Хэрэглэгчид солилцохоор нээлттэй болгосон зүйлс"
      href="/search"
    >
      <BookGrid listings={listings} />
    </Section>
  )
}

/**
 * What people are asking for. A request is a post, so the feed carries them
 * next to the listings rather than hiding them in a private wishlist.
 */
async function RequestRail() {
  const me = await getSessionUser()
  const requests = await getRequestFeed(me?.id ?? null, { limit: 5 })
  if (requests.length === 0) {
    return (
      <EmptyState
        title="Одоогоор сураглал байхгүй"
        description="Сураглаж буйгаа нийтэлбэл тэр нь байгаа хүн доор нь хариу бичнэ."
      />
    )
  }
  return <RequestList requests={requests} />
}

function RailSkeleton() {
  return <div className={styles.skeleton} aria-hidden="true" />
}

export default async function HomePage() {
  return (
    <>
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <span className={styles.heroKicker}>Solio ном солилцоо</span>
              <h1 className={styles.heroTitle}>
                Уншсан номоо солилцож, 
                <br />
                <span className={styles.heroAccent}> хүссэн номоо ол.</span>
              </h1>
              <p className={styles.heroText}>
                Номоо бүртгэж, бусад хэрэглэгчийн номтой шууд солилцоорой.
                Солилцоо бүрийн түүх бүрэн хадгалагдана.
              </p>
            </div>

            <div className={styles.heroVisual} aria-hidden="true">
              <div className={styles.stack}>
                <span className={`${styles.cover} ${styles.coverA}`} />
                <span className={`${styles.cover} ${styles.coverB}`} />
                <span className={`${styles.cover} ${styles.coverC}`} />
                <span className={`${styles.cover} ${styles.coverD}`} />
                <span className={`${styles.cover} ${styles.coverE}`} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container">
        <Section
          title="Шинээр нэмэгдсэн"
          description="Хамгийн сүүлд нэмэгдсэн, солилцох боломжтой зүйлс"
          href="/search"
        >
          <Suspense fallback={<RailSkeleton />}>
            <RecentlyAdded />
          </Suspense>
        </Section>

        <Section
          title="Ном хүсэж байна"
          description="Хэн юу сураглаж байна — танд байвал доор нь хариу бичээрэй"
          href="/requests"
        >
          <Suspense fallback={<RailSkeleton />}>
            <RequestRail />
          </Suspense>
        </Section>

        <Suspense fallback={<RailSkeleton />}>
          <MoreListings />
        </Suspense>
      </div>
    </>
  )
}

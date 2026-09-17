import { Suspense } from 'react'
import { BookGrid } from '@/components/BookCard'
import { EmptyState, Section } from '@/components/ui'
import { getListings } from '@/features/books/queries'
import { RequestList } from '@/features/requests/RequestCard'
import { getRequestFeed } from '@/features/requests/queries'
import { getSessionUser } from '@/lib/auth/dal'
import { ITEMS_LABEL_LOWER } from '@/types/domain'
import styles from './page.module.css'

/**
 * What is actually on offer, newest first.
 *
 * Open listings only. A book that has already changed hands is still worth
 * seeing — it is the site working — but it was arriving in the first row on the
 * front page, where every card is an invitation to swap and half of them could
 * not be swapped for. Those have their own section further down.
 */
async function RecentlyAdded() {
  const listings = await getListings({ limit: 6, statusIn: ['available'] })
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
  const listings = await getListings({ limit: 12, offset: 6, statusIn: ['available'] })
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
 * Things that have already changed hands.
 *
 * Kept on the page rather than hidden: a feed with no evidence that anything
 * ever completes reads as an empty shop. Kept off the top for the same reason —
 * nobody can act on these.
 */
async function RecentlySwapped() {
  const listings = await getListings({ limit: 6, statusIn: ['swapped'] })
  if (listings.length === 0) return null
  return (
    <Section
      title="Саяхан солилцсон"
      description="Аль хэдийн эзэн нь солигдсон зүйлс. Эзэмшигч нь дахин нээвэл солилцоонд гарна."
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
        {/* The colour wash, drifting. Three soft blobs on long, offset,
            alternating cycles: no two ever line up, so the movement reads as
            something settling rather than as a loop. Held apart from the
            texture layer so a repeating pattern can be dropped behind it
            without either one having to know about the other. */}
        <div className={styles.heroWash} aria-hidden="true">
          <span className={styles.washA} />
          <span className={styles.washB} />
          <span className={styles.washC} />
        </div>
        {/* The grain. Defined as `.tex-paper` in globals.css; drop that class
            to turn the texture off. */}
        <div className={`${styles.heroTexture} tex-paper`} aria-hidden="true" />

        <div className="container">
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <span className={styles.heroKicker}>Solio-той солилцоо</span>
              <h1 className={styles.heroTitle}>
                <span className={styles.heroBrand}>Номын солио</span>
                <span className={styles.heroAccent}> цагаан</span>
              </h1>
              <p className={styles.heroText}>
                Уншсан номоо солилцож, хүссэн номо ол
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
          title="Сураглаж байна"
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

        <Suspense fallback={null}>
          <RecentlySwapped />
        </Suspense>
      </div>
    </>
  )
}

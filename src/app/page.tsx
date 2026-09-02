import { Suspense } from 'react'
import { BookGrid } from '@/components/BookCard'
import { SearchBar } from '@/components/SearchBar'
import { EmptyState, Section } from '@/components/ui'
import { getPopular, getRecentlyAdded } from '@/features/books/queries'
import { getSessionUser } from '@/lib/auth/dal'
import styles from './page.module.css'

async function RecentlyAdded() {
  const listings = await getRecentlyAdded(6)
  if (listings.length === 0) {
    return (
      <EmptyState
        title="Одоогоор ном байхгүй байна"
        description="Эхний номыг нэмсэн хүн та байж болно."
      />
    )
  }
  return <BookGrid listings={listings} />
}

async function Popular() {
  return <BookGrid listings={await getPopular(6)} />
}

function RailSkeleton() {
  return <div className={styles.skeleton} aria-hidden="true" />
}

export default async function HomePage() {
  const user = await getSessionUser()

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
                <span className={styles.heroAccent}>хүссэн номоо ол.</span>
              </h1>
              <p className={styles.heroText}>
                Номоо бүртгэж, бусад хэрэглэгчийн номтой шууд солилцоорой.
                Солилцоо бүрийн түүх бүрэн хадгалагдана.
              </p>
              <div className={styles.heroSearch}>
                <SearchBar size="lg" />
              </div>
              <div className={styles.heroFeatures}>
                <span className={styles.feature}>
                  <span className={styles.featureDot} aria-hidden="true" /> Ном хайх
                </span>
                <span className={styles.feature}>
                  <span className={styles.featureDot} aria-hidden="true" /> Шууд солилцоо
                </span>
                <span className={styles.feature}>
                  <span className={styles.featureDot} aria-hidden="true" /> Түүх хадгалагддаг
                </span>
              </div>
            </div>

            <div className={styles.heroVisual} aria-hidden="true">
              <div className={styles.stack}>
                <span className={`${styles.cover} ${styles.coverA}`} />
                <span className={`${styles.cover} ${styles.coverB}`} />
                <span className={`${styles.cover} ${styles.coverC}`} />
                <span className={`${styles.cover} ${styles.coverD}`} />
                <span className={`${styles.cover} ${styles.coverE}`} />
              </div>
              <div className={styles.swapTag}>
                <span className={styles.swapArrows}>⇄</span>
                <span className={styles.swapLabel}>ном солилцоо</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container">
        <Section
          title="Шинээр нэмэгдсэн"
          description="Хамгийн сүүлд нэмэгдсэн, солилцох боломжтой номнууд"
          href="/search"
        >
          <Suspense fallback={<RailSkeleton />}>
            <RecentlyAdded />
          </Suspense>
        </Section>

        <Section
          title={user ? 'Танд санал болгох' : 'Түгээмэл'}
          description={
            user
              ? 'Одоогоор ерөнхий санал — уншсан түүх дээр тулгуурласан санал дараа нэмэгдэнэ'
              : 'Хамгийн олон хувьтай, солилцоход хялбар номнууд'
          }
          href="/search"
        >
          <Suspense fallback={<RailSkeleton />}>
            <Popular />
          </Suspense>
        </Section>
      </div>
    </>
  )
}

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
    <div className="container">
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Уншсан номоо солилцож,
          <br />
          хүссэн номоо ол.
        </h1>
        <p className={styles.heroText}>
          Номоо бүртгэж, бусад хэрэглэгчийн номтой шууд солилцоорой.
          <br />
          Солилцоо бүрийн түүх бүрэн хадгалагдана.
        </p>
        <div className={styles.heroSearch}>
          <SearchBar size="lg" />
        </div>
      </section>

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
  )
}

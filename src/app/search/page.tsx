import { BookGrid } from '@/components/BookCard'
import { SearchBar } from '@/components/SearchBar'
import { EmptyState, Section } from '@/components/ui'
import { getPopular, getRecentlyAdded, searchBooks } from '@/features/books/queries'
import styles from './page.module.css'

export const metadata = { title: 'Explore' }

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const params = await searchParams
  const raw = params.q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? ''

  const results = q ? await searchBooks(q) : []

  return (
    <div className="container">
      <div className={styles.searchHead}>
        <SearchBar initialQuery={q} size="lg" autoFocus={!q} />
      </div>

      {q ? (
        <>
          <div className={styles.divider} />
          <p className={styles.summary}>
            <strong>{q}</strong> — {results.length} үр дүн
          </p>
          {results.length > 0 ? (
            <BookGrid listings={results} />
          ) : (
            <EmptyState
              title="Илэрц олдсонгүй"
              description="Өөр түлхүүр үг ашиглаж үзнэ үү. Одоогийн хайлт нь энгийн текст тааруулалт хийж байгаа — үсгийн алдаа тэсвэрлэх бүтэн текст хайлт дараагийн алхамд нэмэгдэнэ."
            />
          )}
        </>
      ) : (
        <>
          <div className={styles.divider} />
          <ExploreSections />
        </>
      )}
    </div>
  )
}

async function ExploreSections() {
  const [popular, recent] = await Promise.all([getPopular(8), getRecentlyAdded(10)])
  return (
    <>
      <Section title="Яг одоо алдартай" description="Хамгийн их солилцоонд нээлттэй номнууд">
        <BookGrid listings={popular} />
      </Section>
      <Section
        title="Саяхан нэмэгдсэн"
        description="Шинээр бүртгэгдсэн, хайж буй номоо эртхэн олоорой."
      >
        <BookGrid listings={recent} />
      </Section>
    </>
  )
}

import { BookGrid } from '@/components/BookCard'
import { SearchBar } from '@/components/SearchBar'
import { EmptyState, PageHeader } from '@/components/ui'
import { getRecentlyAdded, searchBooks } from '@/features/books/queries'
import styles from './page.module.css'

export const metadata = { title: 'Хайлт' }

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const params = await searchParams
  const raw = params.q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? ''

  const results = q ? await searchBooks(q) : []
  const browse = q ? [] : await getRecentlyAdded(12)

  return (
    <div className="container">

      <PageHeader
        title="Ном хайх"
        subtitle="Номын нэр, зохиогч, ISBN, хэвлэлийн газраар хайна."
      />

      <div className={styles.bar}>
        <SearchBar initialQuery={q} size="lg" autoFocus={!q} />
      </div>

      {q ? (
        <>
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
          <p className={styles.summary}>Бүх ном</p>
          <BookGrid listings={browse} />
        </>
      )}
    </div>
  )
}

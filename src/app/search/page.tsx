import Link from 'next/link'
import { BookGrid } from '@/components/BookCard'
import { SearchBar } from '@/components/SearchBar'
import { EmptyState, Section } from '@/components/ui'
import { getListings, searchListings, searchProfiles } from '@/features/books/queries'
import type { ProfileResult } from '@/features/books/queries'
import styles from './page.module.css'

export const metadata = { title: 'Номнууд' }

function PeopleResults({ people }: { people: ProfileResult[] }) {
  if (people.length === 0) return null
  return (
    <Section title="Хэрэглэгчид" description="Хайлтад тохирсон хүмүүс">
      <ul className={styles.people}>
        {people.map((p) => (
          <li key={p.username}>
            <Link href={`/u/${p.username}`} className={styles.person}>
              <span className={styles.personAvatar} aria-hidden="true">
                {p.displayName.charAt(0)}
              </span>
              <span className={styles.personBody}>
                <span className={styles.personName}>{p.displayName}</span>
                <span className={styles.personMeta}>
                  @{p.username}
                  {p.city ? ` · ${p.city}` : ''} · {p.listingCount} ном
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const params = await searchParams
  const raw = params.q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? ''

  // One box, two kinds of answer: books people are offering, and the people
  // themselves.
  const [results, people] = q
    ? await Promise.all([searchListings(q), searchProfiles(q)])
    : [[], []]

  return (
    <div className="container">
      <div className={styles.searchHead}>
        <SearchBar initialQuery={q} size="lg" autoFocus={!q} />
      </div>

      {q ? (
        <>
          <div className={styles.divider} />
          <p className={styles.summary}>
            <strong>{q}</strong> — {results.length} ном
            {people.length > 0 ? `, ${people.length} хэрэглэгч` : ''}
          </p>

          <PeopleResults people={people} />

          {results.length > 0 ? (
            <BookGrid listings={results} />
          ) : (
            people.length === 0 && (
              <EmptyState
                title="Илэрц олдсонгүй"
                description="Өөр түлхүүр үг ашиглаж үзнэ үү. Одоогийн хайлт нь энгийн текст тааруулалт хийж байгаа — үсгийн алдаа тэсвэрлэх бүтэн текст хайлт дараагийн алхамд нэмэгдэнэ."
              />
            )
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
  const listings = await getListings({ limit: 24 })
  if (listings.length === 0) {
    return (
      <EmptyState
        title="Одоогоор ном байхгүй байна"
        description="Эхний номыг нэмсэн хүн та байж болно."
      />
    )
  }
  return (
    <>
      <Section
        title="Саяхан нэмэгдсэн"
        description="Хэрэглэгчид солилцохоор нээлттэй болгосон номнууд"
      >
        <BookGrid listings={listings.slice(0, 12)} />
      </Section>
      {listings.length > 12 && (
        <Section title="Цааш үзэх" description="Бусад нээлттэй номнууд">
          <BookGrid listings={listings.slice(12)} />
        </Section>
      )}
    </>
  )
}

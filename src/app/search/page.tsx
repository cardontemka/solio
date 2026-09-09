import Link from 'next/link'
import { BookGrid } from '@/components/BookCard'
import { EmptyState, Section } from '@/components/ui'
import { Pager } from '@/components/Pager'
import { getListings, searchListings, searchProfiles } from '@/features/books/queries'
import type { ProfileResult } from '@/features/books/queries'
import { pageFrom, splitPage } from '@/lib/paging'
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

const PER_PAGE = 24

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const params = await searchParams
  const raw = params.q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? ''
  const rawCat = params.category
  const category = (Array.isArray(rawCat) ? rawCat[0] : rawCat) || undefined
  const info = pageFrom(params, PER_PAGE)

  // One box, two kinds of answer: books people are offering, and the people
  // themselves. People are not paged — the list is capped at twelve and is a
  // sidebar to the books, not a result set of its own.
  const [rows, people] = q
    ? await Promise.all([
        searchListings(q, category, { limit: info.fetch, offset: info.offset }),
        searchProfiles(q),
      ])
    : [[], []]
  const { items: results, hasMore } = splitPage(rows, info)

  return (
    <div className="container">
      {q ? (
        <>
          <div className={styles.divider} />
          <p className={styles.summary}>
            <strong>{q}</strong>
            {info.page > 1 ? ` — хуудас ${info.page}` : ''}
            {people.length > 0 ? ` · ${people.length} хэрэглэгч` : ''}
          </p>

          <PeopleResults people={people} />

          {results.length > 0 ? (
            /* Results are the first thing on this page, so one of these covers
               is its LCP. */
            <>
              <BookGrid listings={results} priorityCount={4} />
              <Pager page={info.page} hasMore={hasMore} params={params} basePath="/search" />
            </>
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
          <ExploreSections category={category} params={params} info={info} />
        </>
      )}
    </div>
  )
}

async function ExploreSections({
  category,
  params,
  info,
}: {
  category?: string
  params: Record<string, string | string[] | undefined>
  info: ReturnType<typeof pageFrom>
}) {
  const { items: listings, hasMore } = splitPage(
    await getListings({ limit: info.fetch, offset: info.offset, category }),
    info
  )
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
        title={info.page > 1 ? `Номнууд — хуудас ${info.page}` : 'Саяхан нэмэгдсэн'}
        description="Хэрэглэгчид солилцохоор нээлттэй болгосон номнууд"
      >
        <BookGrid listings={listings} priorityCount={4} />
      </Section>
      <Pager page={info.page} hasMore={hasMore} params={params} basePath="/search" />
    </>
  )
}

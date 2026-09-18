import Link from 'next/link'
import { BookGrid } from '@/components/BookCard'
import { EmptyState, Section } from '@/components/ui'
import { Pager } from '@/components/Pager'
import { getListings, searchListings, searchProfiles } from '@/features/books/queries'
import type { ProfileResult } from '@/features/books/queries'
import { RequestList } from '@/features/requests/RequestCard'
import { searchRequests } from '@/features/requests/queries'
import { SearchSignal } from '@/features/discovery/SearchSignal'
import { getSessionUser } from '@/lib/auth/dal'
import { pageFrom, splitPage } from '@/lib/paging'
import { ITEM_KIND, KIND_COPY, type ItemKind } from '@/types/domain'
import styles from './page.module.css'

export const metadata = { title: 'Ном, пянз' }

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
                  {p.city ? ` · ${p.city}` : ''} · {p.listingCount} нээлттэй
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
  const rawKind = params.kind
  const kindParam = (Array.isArray(rawKind) ? rawKind[0] : rawKind) || undefined
  const kind = (ITEM_KIND as readonly string[]).includes(kindParam ?? '') ? kindParam : undefined
  const info = pageFrom(params, PER_PAGE)

  // One box, three kinds of answer: books people are offering, books people are
  // looking for, and the people themselves. Only the offers are paged — the
  // other two are capped and sit alongside the grid rather than being result
  // sets of their own.
  //
  // Requests are here and not in the header's type-ahead on purpose: the
  // dropdown offers things to open, and a request is somebody to answer.
  const me = q ? await getSessionUser() : null
  const [rows, people, requests] = q
    ? await Promise.all([
        searchListings(q, category, { limit: info.fetch, offset: info.offset, kind }),
        searchProfiles(q),
        searchRequests(q, me?.id ?? null),
      ])
    : [[], [], []]
  const { items: results, hasMore } = splitPage(rows, info)

  return (
    <div className="container">
      {q ? (
        <>
          {/* Renders nothing. It tells the server what was typed, which orders
              this reader's own suggestions and is the one number on the admin
              page that says what the site is short of. */}
          <SearchSignal query={q} />
          <div className={styles.divider} />
          <p className={styles.summary}>
            <strong>{q}</strong>
            {info.page > 1 ? ` — хуудас ${info.page}` : ''}
            {people.length > 0 ? ` · ${people.length} хэрэглэгч` : ''}
            {requests.length > 0 ? ` · ${requests.length} сураглал` : ''}
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
            people.length === 0 &&
            requests.length === 0 && (
              <EmptyState
                title="Илэрц олдсонгүй"
                description="Өөр түлхүүр үг ашиглаж үзнэ үү. Одоогийн хайлт нь энгийн текст тааруулалт хийж байгаа — үсгийн алдаа тэсвэрлэх бүтэн текст хайлт дараагийн алхамд нэмэгдэнэ."
              />
            )
          )}

          {/* Underneath the offers, because somebody searching a title wants to
              know first whether they can have one. When nothing came back, this
              is the more useful half of the page: nobody is offering it, these
              people want it too, and whoever owns a copy can say so. */}
          {requests.length > 0 && (
            <Section
              title="Сураглаж байна"
              description={
                results.length > 0
                  ? 'Үүнийг хайж буй хүмүүс. Танд байвал доор нь хариу бичээрэй'
                  : 'Одоогоор хэн ч санал болгоогүй байна. Гэхдээ эдгээр хүмүүс үүнийг хайж байна'
              }
              href="/requests"
            >
              <RequestList requests={requests} />
            </Section>
          )}
        </>
      ) : (
        <>
          <div className={styles.divider} />
          <ExploreSections category={category} kind={kind} params={params} info={info} />
        </>
      )}
    </div>
  )
}

async function ExploreSections({
  category,
  kind,
  params,
  info,
}: {
  category?: string
  kind?: string
  params: Record<string, string | string[] | undefined>
  info: ReturnType<typeof pageFrom>
}) {
  const { items: listings, hasMore } = splitPage(
    await getListings({ limit: info.fetch, offset: info.offset, category, kind }),
    info
  )
  if (listings.length === 0) {
    return (
      <EmptyState
        title="Одоогоор юу ч байхгүй байна"
        description="Эхнийхийг нь нэмсэн хүн та байж болно."
      />
    )
  }
  return (
    <>
      <Section
        title={
          info.page > 1
            ? `${kind ? KIND_COPY[kind as ItemKind].one : 'Бүгд'} — хуудас ${info.page}`
            : 'Саяхан нэмэгдсэн'
        }
        description="Хэрэглэгчид солилцохоор нээлттэй болгосон зүйлс"
      >
        <BookGrid listings={listings} priorityCount={4} />
      </Section>
      <Pager page={info.page} hasMore={hasMore} params={params} basePath="/search" />
    </>
  )
}

import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Avatar } from '@/components/Avatar'
import { ClockIcon, PinIcon } from '@/components/Icons'
import { BookGrid } from '@/components/BookCard'
import { EmptyState } from '@/components/ui'
import { Pager } from '@/components/Pager'
import { getPublicProfile, getSwapHistory } from '@/features/books/queries'
import { getMyStoredListings, getStoragePointFor } from '@/features/storage/queries'
import { StoragePointDetails } from '@/features/storage/StoragePointDetails'
import { getSessionUser } from '@/lib/auth/dal'
import { ITEMS_LABEL, STORAGE_POINT_KIND_LABEL } from '@/types/domain'
import { pageFrom, splitPage } from '@/lib/paging'
import styles from './page.module.css'

/**
 * Someone else's profile. Everything here is already public through RLS —
 * profiles are world-readable and only 'available' copies are listed — so this
 * page adds no new exposure. The viewer's own private lists live at /dashboard.
 */
const loadProfile = cache(getPublicProfile)

const PER_PAGE = 24
const HISTORY_PER_PAGE = 10

type Props = {
  params: Promise<{ username: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props) {
  // Page one deliberately: the title and description need the profile, not its
  // listings, and asking for the same page the body asks for would only matter
  // if they differed — they do not, because cache() keys on the arguments.
  const profile = await loadProfile((await params).username, { limit: PER_PAGE + 1, offset: 0 })
  if (!profile) return { title: 'Хэрэглэгч олдсонгүй' }
  return {
    title: `${profile.displayName} (@${profile.username})`,
    description: profile.bio ?? `${profile.displayName}-ийн солилцоонд нээлттэй ном, пянз.`,
  }
}

export default async function PublicProfilePage({ params, searchParams }: Props) {
  const { username } = await params
  const query = await searchParams
  const info = pageFrom(query, PER_PAGE)
  const historyInfo = pageFrom(query, HISTORY_PER_PAGE, 'hpage')

  const [profile, me] = await Promise.all([
    loadProfile(username, { limit: info.fetch, offset: info.offset }),
    getSessionUser(),
  ])
  if (!profile) notFound()

  const isMe = me?.id === profile.id
  // A venue's page is mostly its premises and its shelf; an ordinary profile
  // pays for neither query.
  const point =
    profile.accountType === 'storage_point'
      ? await getStoragePointFor(profile.id, profile.username)
      : null
  // The shelf is the venue's own business — what it is holding for other
  // people, and for whom. Only the venue sees it; everybody else sees what it
  // owns, which is the pool they can actually take something from.
  const shelf = point && isMe ? await getMyStoredListings() : []
  const { items: listings, hasMore } = splitPage(profile.listings, info)
  const { items: history, hasMore: moreHistory } = splitPage(
    await getSwapHistory(profile.id, { limit: historyInfo.fetch, offset: historyInfo.offset }),
    historyInfo
  )

  return (
    <div className="container">
      {/* The page leads with who this is and what they have. Everything else —
          when they joined, what a café's capacity is, the whole swap history —
          is a click away: it is worth keeping, and it was crowding out the
          books, which are the reason anybody opens somebody's profile. */}
      <header className={styles.hero} data-cover={Boolean(point?.coverUrl)}>
        {point?.coverUrl && (
          <>
            <Image
              className={styles.heroImage}
              src={point.coverUrl}
              alt=""
              fill
              sizes="(max-width: 900px) 100vw, 900px"
              priority
              unoptimized
            />
            <span className={styles.heroVeil} aria-hidden="true" />
          </>
        )}

        <Avatar name={profile.displayName} src={profile.avatarUrl} size={72} />

        <div className={styles.heroText}>
          <h1 className={styles.name}>{profile.displayName}</h1>
          <p className={styles.handle}>
            @{profile.username}
            {point && <span className={styles.kind}>{STORAGE_POINT_KIND_LABEL[point.kind]}</span>}
          </p>

          {(point?.description ?? profile.bio) && (
            <p className={styles.bio}>{point?.description ?? profile.bio}</p>
          )}

          <div className={styles.chips}>
            {point ? (
              <>
                <span className={styles.chip}>
                  <PinIcon size={14} />
                  {point.district}, {point.city}
                </span>
                <span className={styles.chip}>
                  <ClockIcon size={14} />
                  {point.hours}
                </span>
              </>
            ) : (
              profile.city && (
                <span className={styles.chip}>
                  <PinIcon size={14} />
                  {profile.city}
                </span>
              )
            )}
            <span className={styles.chipStrong}>
              {profile.availableCount} нээлттэй
            </span>
          </div>

          {isMe && (
            <div className={styles.heroActions}>
              <Link className={styles.selfLink} href="/dashboard">
                Миний хуудас
              </Link>
            </div>
          )}

          <details className={styles.more}>
            <summary className={styles.moreSummary}>Дэлгэрэнгүй</summary>
            <div className={styles.moreBody}>
              {point ? (
                <StoragePointDetails point={point} />
              ) : (
                <dl className={styles.facts}>
                  <dt>Solio-д нэгдсэн</dt>
                  <dd>{profile.joinedAt}</dd>
                  {profile.city && (
                    <>
                      <dt>Байршил</dt>
                      <dd>{profile.city}</dd>
                    </>
                  )}
                </dl>
              )}
            </div>
          </details>
        </div>
      </header>

      {point && isMe && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Танд хадгалагдаж буй</h2>
          <p className={styles.sectionNote}>
            Эзэд нь тань дээр түр хадгалуулсан ном, пянз. Энэ жагсаалтыг зөвхөн та
            харна — эзэмшигч, солилцох нөгөө тал нь өөрсдийнхөө зүйлийг л харна.
          </p>
          {shelf.length === 0 ? (
            <EmptyState
              title="Одоогоор юу ч хадгалагдаагүй"
              description="Хэн нэгэн ном, пянзаа тань дээр хадгалуулбал энд харагдана."
            />
          ) : (
            <BookGrid listings={shelf} priorityCount={4} />
          )}
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {point ? 'Оноогоор авч болох' : ITEMS_LABEL}
        </h2>

        {listings.length === 0 ? (
          <EmptyState
            title="Нээлттэй зүйл байхгүй"
            description={
              point
                ? 'Хандивлагдсан ном, пянз энд харагдана. Нэгийг нь авахад 1 оноо хэрэгтэй.'
                : isMe
                  ? 'Ном, пянзаа нэмэх эсвэл түр нуухаа болиход энд харагдана.'
                  : 'Энэ хэрэглэгч одоогоор юу ч зарлаагүй байна.'
            }
          />
        ) : (
          <>
            <BookGrid listings={listings} priorityCount={4} />
            <Pager
              page={info.page}
              hasMore={hasMore}
              params={query}
              basePath={`/u/${profile.username}`}
            />
          </>
        )}
      </section>

      {history.length > 0 && (
        <details className={styles.historyBlock}>
          <summary className={styles.historySummary}>
            Солилцооны түүх ({history.length}
            {moreHistory ? '+' : ''})
          </summary>
          <ul className={styles.history}>
            {history.map((h) => (
              <li key={h.swapId} className={styles.historyItem}>
                <div className={styles.historyBooks}>
                  <span className={styles.gave}>{h.gave.join(', ') || '—'}</span>
                  <span className={styles.arrow} aria-hidden="true">⇄</span>
                  <span className={styles.received}>{h.received.join(', ') || '—'}</span>
                </div>
                <p className={styles.historyMeta}>
                  <Link href={`/u/${h.counterpartyUsername}`} className={styles.counterparty}>
                    {h.counterpartyName}
                  </Link>
                  {' · '}
                  {h.completedAt}
                </p>
              </li>
            ))}
          </ul>
          <Pager
            page={historyInfo.page}
            hasMore={moreHistory}
            params={query}
            basePath={`/u/${profile.username}`}
            paramKey="hpage"
          />
        </details>
      )}
    </div>
  )
}

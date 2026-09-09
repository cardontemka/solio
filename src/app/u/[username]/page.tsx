import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Avatar } from '@/components/Avatar'
import { BookGrid } from '@/components/BookCard'
import { Badge, EmptyState, PageHeader } from '@/components/ui'
import { Pager } from '@/components/Pager'
import { getPublicProfile, getSwapHistory } from '@/features/books/queries'
import { getSessionUser } from '@/lib/auth/dal'
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
    description: profile.bio ?? `${profile.displayName}-ийн солилцоонд нээлттэй номнууд.`,
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
  const { items: listings, hasMore } = splitPage(profile.listings, info)
  const { items: history, hasMore: moreHistory } = splitPage(
    await getSwapHistory(profile.id, { limit: historyInfo.fetch, offset: historyInfo.offset }),
    historyInfo
  )

  return (
    <div className="container">
      <PageHeader
        title={profile.displayName}
        subtitle={`@${profile.username} · ${profile.joinedAt}-нээс Solio-д`}
        action={isMe ? <Link className={styles.selfLink} href="/dashboard">Миний хуудас</Link> : undefined}
      />

      <div className={styles.identity}>
        <Avatar name={profile.displayName} src={profile.avatarUrl} size={56} />
        {profile.city && <Badge>📍 {profile.city}</Badge>}
        <Badge tone="accent">{profile.availableCount} ном нээлттэй</Badge>
      </div>

      {profile.bio && <p className={styles.bio}>{profile.bio}</p>}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Номнууд</h2>

        {listings.length === 0 ? (
          <EmptyState
            title="Нээлттэй ном байхгүй"
            description={
              isMe
                ? 'Номоо нэмэх эсвэл түр нуухаа болиход энд харагдана.'
                : 'Энэ хэрэглэгч одоогоор ном зарлаагүй байна.'
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
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Солилцооны түүх</h2>
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
        </section>
      )}
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Avatar } from '@/components/Avatar'
import { BookGrid } from '@/components/BookCard'
import { Badge, EmptyState, PageHeader } from '@/components/ui'
import { getPublicProfile } from '@/features/books/queries'
import { getSessionUser } from '@/lib/auth/dal'
import styles from './page.module.css'

/**
 * Someone else's profile. Everything here is already public through RLS —
 * profiles are world-readable and only 'available' copies are listed — so this
 * page adds no new exposure. The viewer's own private lists live at /dashboard.
 */
const loadProfile = cache(getPublicProfile)

type Props = { params: Promise<{ username: string }> }

export async function generateMetadata({ params }: Props) {
  const profile = await loadProfile((await params).username)
  if (!profile) return { title: 'Хэрэглэгч олдсонгүй' }
  return {
    title: `${profile.displayName} (@${profile.username})`,
    description: profile.bio ?? `${profile.displayName}-ийн солилцоонд нээлттэй номнууд.`,
  }
}

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params
  const [profile, me] = await Promise.all([loadProfile(username), getSessionUser()])
  if (!profile) notFound()

  const isMe = me?.id === profile.id

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
        <Badge tone="accent">
          {profile.listings.filter((l) => l.status === 'available').length} ном нээлттэй
        </Badge>
      </div>

      {profile.bio && <p className={styles.bio}>{profile.bio}</p>}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Номнууд</h2>

        {profile.listings.length === 0 ? (
          <EmptyState
            title="Нээлттэй ном байхгүй"
            description={
              isMe
                ? 'Номоо нэмэх эсвэл түр нуухаа болиход энд харагдана.'
                : 'Энэ хэрэглэгч одоогоор ном зарлаагүй байна.'
            }
          />
        ) : (
          <BookGrid listings={profile.listings} />
        )}
      </section>
    </div>
  )
}

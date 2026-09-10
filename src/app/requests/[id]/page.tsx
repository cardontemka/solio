import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Avatar } from '@/components/Avatar'
import { Badge } from '@/components/ui'
import { CommentSection } from '@/features/comments/CommentSection'
import { getComments } from '@/features/comments/queries'
import { ReportButton } from '@/features/moderation/ReportButton'
import { RequestActions } from '@/features/requests/RequestActions'
import { getRequest } from '@/features/requests/queries'
import { getOfferableCopies } from '@/features/swaps/queries'
import { getSessionUser } from '@/lib/auth/dal'
import styles from './page.module.css'

/**
 * One request post and the answers under it. The answers are ordinary comments
 * — somebody offering the book says so in words, the same as anyone else.
 */
const load = cache(getRequest)

export async function generateMetadata({ params }: PageProps<'/requests/[id]'>) {
  const { id } = await params
  const request = await load(id, null)
  if (!request) return { title: 'Хүсэлт олдсонгүй' }
  return {
    title: `${request.title} — ном хүсэлт`,
    description: request.note ?? undefined,
  }
}

export default async function RequestPage({ params }: PageProps<'/requests/[id]'>) {
  const { id } = await params
  const me = await getSessionUser()
  const [request, comments, offerable] = await Promise.all([
    load(id, me?.id ?? null),
    getComments({ requestId: id }, me?.id ?? null),
    // Only somebody else's request is worth answering with your own book.
    me ? getOfferableCopies(me.id) : Promise.resolve([]),
  ])
  if (!request) notFound()

  return (
    <div className="container">
      <div className={styles.shell}>
        <nav className={styles.crumbs}>
          <Link href="/">Нүүр</Link> <span>/</span>
          <Link href="/requests">Ном хүсэх</Link> <span>/</span>
          <span className={styles.crumbCurrent}>{request.title}</span>
        </nav>

        <article className={styles.post}>
          <div className={styles.head}>
            <h1 className={styles.title}>{request.title}</h1>
            {request.status === 'fulfilled' && <Badge tone="ok">Олдсон</Badge>}
            {request.status === 'cancelled' && <Badge>Цуцалсан</Badge>}
            {request.status === 'open' && <Badge tone="warn">Хайж байна</Badge>}
          </div>

          {request.imageUrl && (
            <Image
              className={styles.photo}
              src={request.imageUrl}
              alt={request.title}
              width={220}
              height={300}
              unoptimized
            />
          )}

          {request.author && <p className={styles.author}>{request.author}</p>}
          {request.isbn && <p className={styles.isbn}>ISBN {request.isbn}</p>}
          {request.note && <p className={styles.note}>{request.note}</p>}

          <div className={styles.meta}>
            <Link href={`/u/${request.authorUsername}`} className={styles.poster}>
              <Avatar name={request.authorName} size={26} />
              {request.authorName}
            </Link>
            <span className={styles.date}>{request.createdAt}</span>
            {me && !request.isMine && (
              <ReportButton entityType="request" entityId={request.id} variant="icon" />
            )}
          </div>

          {request.isMine && <RequestActions id={request.id} status={request.status} />}
        </article>

        <CommentSection
          target={{ requestId: request.id }}
          path={`/requests/${request.id}`}
          comments={comments}
          canComment={Boolean(me)}
          viewerId={me?.id ?? null}
          offerable={request.isMine ? [] : offerable}
        />
      </div>
    </div>
  )
}

import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '@/components/ui'
import type { RequestView } from './queries'
import styles from './MyRequestsPanel.module.css'

/**
 * One request in a feed: who is asking, for what, and how many people have
 * answered. The whole card links to the post, where the answers live.
 */
export function RequestCard({ request: r }: { request: RequestView }) {
  return (
    // An <article>, not an <li>: MyRequestsPanel wraps this in its own <li> to
    // sit the poster's controls beside it, and nested list items are invalid.
    <article className={styles.item} data-muted={r.status !== 'open'}>
      {r.imageUrl && (
        <Link href={`/requests/${r.id}`} className={styles.itemThumb}>
          {/* Straight from the bucket, like every other photo on the site —
              already the right size, and no transformation to pay for. */}
          <Image src={r.imageUrl} alt="" width={56} height={78} unoptimized />
        </Link>
      )}
      <div className={styles.itemBody}>
        <div className={styles.itemHead}>
          <Link href={`/requests/${r.id}`} className={styles.itemTitle}>
            {r.title}
          </Link>
          {r.status === 'fulfilled' && <Badge tone="ok">Олдсон</Badge>}
          {r.status === 'cancelled' && <Badge>Цуцалсан</Badge>}
          {r.status === 'open' && <Badge tone="warn">Хайж байна</Badge>}
        </div>

        {r.author && <p className={styles.itemAuthor}>{r.author}</p>}
        {r.isbn && <p className={styles.isbn}>ISBN {r.isbn}</p>}
        {r.note && <p className={styles.note}>{r.note}</p>}

        <p className={styles.date}>
          <Link href={`/u/${r.authorUsername}`} className={styles.poster}>
            {r.authorName}
          </Link>
          {' · '}
          {r.createdAt}
          {' · '}
          <Link href={`/requests/${r.id}`} className={styles.commentLink}>
            {r.commentCount} сэтгэгдэл
          </Link>
        </p>
      </div>
    </article>
  )
}

export function RequestList({ requests }: { requests: RequestView[] }) {
  return (
    <ul className={styles.list}>
      {requests.map((r) => (
        <li key={r.id} className={styles.row}>
          <RequestCard request={r} />
        </li>
      ))}
    </ul>
  )
}

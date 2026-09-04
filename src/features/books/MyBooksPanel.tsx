import Link from 'next/link'
import type { ReactNode } from 'react'
import { BookCover } from '@/components/BookCard'
import { Badge, EmptyState } from '@/components/ui'
import { CONDITION_LABEL, COPY_STATUS_LABEL, type CopyStatus } from '@/types/domain'
import { ListingMenu } from './ListingMenu'
import type { Listing } from './queries'
import styles from './MyBooksPanel.module.css'

/**
 * The owner's shelf, grouped by copy status. Rendered both by /my-books and by
 * the /dashboard panel, so the two can never drift apart.
 */
export type MyCopies = Listing[]

const GROUPS: { status: CopyStatus; title: string; desc: string }[] = [
  { status: 'available', title: 'Боломжтой', desc: 'Солилцоонд нээлттэй байгаа номнууд' },
  { status: 'reserved', title: 'Захиалагдсан', desc: 'Идэвхтэй солилцоонд түгжигдсэн' },
  { status: 'swapped', title: 'Солилцсон', desc: 'Саяхан хүлээн авсан — дахин зарлаагүй' },
  { status: 'inactive', title: 'Идэвхгүй', desc: 'Түр нуусан номнууд' },
]

export function MyBooksPanel({
  copies,
  emptyAction,
}: {
  copies: MyCopies
  emptyAction?: ReactNode
}) {
  if (copies.length === 0) {
    return (
      <EmptyState
        title="Ном бүртгээгүй байна"
        description="Эхний номоо нэмээд солилцоо эхлүүлээрэй."
        action={emptyAction}
      />
    )
  }

  return (
    <>
      {GROUPS.map((group) => {
        const items = copies.filter((l) => l.status === group.status)
        if (items.length === 0) return null
        return (
          <section key={group.status} className={styles.group}>
            <div className={styles.groupHead}>
              <h2 className={styles.groupTitle}>
                {group.title} <span className={styles.count}>{items.length}</span>
              </h2>
              <p className={styles.groupDesc}>{group.desc}</p>
            </div>

            <ul className={styles.list}>
              {items.map((l) => (
                <li key={l.copyId} className={styles.item}>
                  <Link href={`/books/${l.copyId}`} className={styles.thumb}>
                    <BookCover
                      title={l.title}
                      author={l.author}
                      color={l.coverColor}
                      src={l.images[0]?.url}
                      size="sm"
                    />
                  </Link>

                  <div className={styles.itemBody}>
                    <Link href={`/books/${l.copyId}`} className={styles.itemTitle}>
                      {l.title}
                    </Link>
                    {l.author && <p className={styles.itemAuthor}>{l.author}</p>}
                    <div className={styles.itemMeta}>
                      <Badge tone="accent">{CONDITION_LABEL[l.condition]}</Badge>
                      <Badge tone={l.status === 'available' ? 'ok' : 'neutral'}>
                        {COPY_STATUS_LABEL[l.status]}
                      </Badge>
                      {l.transferCount > 0 && <Badge>{l.transferCount} удаа солигдсон</Badge>}
                      <span className={styles.date}>{l.createdAt}-нд нэмсэн</span>
                    </div>
                    {l.conditionNote && <p className={styles.note}>{l.conditionNote}</p>}
                  </div>

                  <div className={styles.itemActions}>
                    <ListingMenu copyId={l.copyId} status={l.status} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}

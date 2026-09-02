import Link from 'next/link'
import { BookCover } from '@/components/BookCard'
import { Badge, ButtonLink, EmptyState, PageHeader } from '@/components/ui'
import { CopyVisibilityButton } from '@/features/books/CopyVisibilityButton'
import { getMyCopies } from '@/features/books/queries'
import { requireUser } from '@/lib/auth/dal'
import { CONDITION_LABEL, COPY_STATUS_LABEL, type CopyStatus } from '@/types/domain'
import styles from './page.module.css'

export const metadata = {
  title: 'Миний номнууд',
  robots: { index: false, follow: false },
}

const GROUPS: { status: CopyStatus; title: string; desc: string }[] = [
  { status: 'available', title: 'Боломжтой', desc: 'Солилцоонд нээлттэй байгаа номнууд' },
  { status: 'reserved', title: 'Захиалагдсан', desc: 'Идэвхтэй солилцоонд түгжигдсэн' },
  { status: 'swapped', title: 'Солилцсон', desc: 'Саяхан хүлээн авсан — дахин зарлаагүй' },
  { status: 'inactive', title: 'Идэвхгүй', desc: 'Түр нуусан номнууд' },
]

export default async function MyBooksPage() {
  const me = await requireUser()
  const copies = await getMyCopies(me.id)

  return (
    <div className="container">
      <PageHeader
        title="Миний номнууд"
        subtitle={`${copies.length} ном бүртгэлтэй. Номоо нэмэх, түр нуух боломжтой.`}
        action={<ButtonLink href="/books/new">Ном нэмэх</ButtonLink>}
      />

      {copies.length === 0 ? (
        <EmptyState
          title="Ном бүртгээгүй байна"
          description="Эхний номоо нэмээд солилцоо эхлүүлээрэй."
          action={<ButtonLink href="/books/new">Ном нэмэх</ButtonLink>}
        />
      ) : (
        GROUPS.map((group) => {
          const items = copies.filter((c) => c.copy.status === group.status)
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
                {items.map(({ copy, book }) => (
                  <li key={copy.id} className={styles.item}>
                    <Link href={`/books/${book.id}`} className={styles.thumb}>
                      <BookCover
                        title={book.title}
                        author={book.author}
                        color={book.coverColor}
                        size="sm"
                      />
                    </Link>

                    <div className={styles.itemBody}>
                      <Link href={`/books/${book.id}`} className={styles.itemTitle}>
                        {book.title}
                      </Link>
                      {book.author && <p className={styles.itemAuthor}>{book.author}</p>}
                      <div className={styles.itemMeta}>
                        <Badge tone="accent">{CONDITION_LABEL[copy.condition]}</Badge>
                        <Badge tone={copy.status === 'available' ? 'ok' : 'neutral'}>
                          {COPY_STATUS_LABEL[copy.status]}
                        </Badge>
                        {copy.transferCount > 0 && (
                          <Badge>{copy.transferCount} удаа солигдсон</Badge>
                        )}
                        <span className={styles.date}>{copy.createdAt}-нд нэмсэн</span>
                      </div>
                      {copy.conditionNote && (
                        <p className={styles.note}>{copy.conditionNote}</p>
                      )}
                    </div>

                    <div className={styles.itemActions}>
                      {(copy.status === 'available' || copy.status === 'inactive') && (
                        <CopyVisibilityButton
                          copyId={copy.id}
                          next={copy.status === 'available' ? 'inactive' : 'available'}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}

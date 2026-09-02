import Link from 'next/link'
import { Badge, EmptyState, PageHeader } from '@/components/ui'
import { AddRequestForm } from '@/features/wishlist/AddRequestForm'
import { RequestActions } from '@/features/wishlist/RequestActions'
import { getMyRequests, type RequestView } from '@/features/wishlist/queries'
import { requireUser } from '@/lib/auth/dal'
import styles from './page.module.css'

export const metadata = {
  title: 'Хүслийн жагсаалт',
  robots: { index: false, follow: false },
}

function RequestRow({ r }: { r: RequestView }) {
  return (
    <li className={styles.item} data-muted={r.status !== 'open'}>
      <div className={styles.itemBody}>
        <div className={styles.itemHead}>
          {r.linkedBookId ? (
            <Link href={`/books/${r.linkedBookId}`} className={styles.itemTitle}>{r.title}</Link>
          ) : (
            <span className={styles.itemTitle}>{r.title}</span>
          )}
          {r.status === 'cancelled' && <Badge>Цуцалсан</Badge>}
          {r.status === 'fulfilled' && <Badge tone="ok">Биелсэн</Badge>}
          {r.status === 'open' && !r.matchedBookId && <Badge>Хайж байна</Badge>}
          {r.status === 'open' && r.matchedBookId && <Badge tone="ok">Олдсон</Badge>}
        </div>

        {r.author && <p className={styles.itemAuthor}>{r.author}</p>}
        {r.isbn && <p className={styles.isbn}>ISBN {r.isbn}</p>}
        {r.note && <p className={styles.note}>{r.note}</p>}

        {r.matchedBookId && (
          <p className={styles.match}>
            ✓ Тохирох ном системд нэмэгдсэн:{' '}
            <Link href={`/books/${r.matchedBookId}`}>{r.matchedTitle ?? 'номыг үзэх'}</Link>
          </p>
        )}

        <p className={styles.date}>{r.createdAt}-нд нэмсэн</p>
      </div>
      <RequestActions id={r.id} status={r.status} />
    </li>
  )
}

export default async function WishlistPage() {
  await requireUser()
  const requests = await getMyRequests()
  const open = requests.filter((r) => r.status === 'open')
  const closed = requests.filter((r) => r.status !== 'open')
  const matched = open.filter((r) => r.matchedBookId).length

  return (
    <div className="container">
      <PageHeader
        title="Хүслийн жагсаалт"
        subtitle={
          matched > 0
            ? `${matched} хүсэлтэд тохирох ном олдсон байна.`
            : 'Хүсэж буй номоо бүртгээрэй. Тохирох ном системд нэмэгдэхэд танд мэдэгдэнэ.'
        }
      />

      <div className={styles.layout}>
        <div className={styles.main}>
          <h2 className={styles.groupTitle}>
            Нээлттэй хүсэлт <span className={styles.count}>{open.length}</span>
          </h2>

          {open.length === 0 ? (
            <EmptyState
              title="Нээлттэй хүсэлт байхгүй"
              description="Хажуугийн формоор хүсэж буй номоо нэмнэ үү."
            />
          ) : (
            <ul className={styles.list}>
              {open.map((r) => <RequestRow key={r.id} r={r} />)}
            </ul>
          )}

          {closed.length > 0 && (
            <>
              <h2 className={`${styles.groupTitle} ${styles.groupTitleSpaced}`}>
                Хаагдсан <span className={styles.count}>{closed.length}</span>
              </h2>
              <ul className={styles.list}>
                {closed.map((r) => <RequestRow key={r.id} r={r} />)}
              </ul>
            </>
          )}
        </div>

        <aside className={styles.aside}>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Ном хүсэх</h3>
            <p className={styles.cardDesc}>
              Системд байхгүй ном ч болно — хэн нэгэн нэмэхэд мэдэгдэл очно.
            </p>
            <AddRequestForm />
          </div>
        </aside>
      </div>
    </div>
  )
}

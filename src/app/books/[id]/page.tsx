import Image from 'next/image'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { BookCover } from '@/components/BookCard'
import { Badge } from '@/components/ui'
import { ReportButton } from '@/features/moderation/ReportButton'
import { ReviewSection } from '@/features/reviews/ReviewSection'
import { getMyReview, getReviewsForBook } from '@/features/reviews/queries'
import { WishlistButton } from '@/features/wishlist/WishlistButton'
import { hasOpenRequestFor } from '@/features/wishlist/queries'
import { getBookDetail } from '@/features/books/queries'
import { getSessionUser } from '@/lib/auth/dal'
import { CONDITION_LABEL } from '@/types/domain'
import type { BookCondition } from '@/types/domain'
import styles from './page.module.css'

export async function generateMetadata({ params }: PageProps<'/books/[id]'>) {
  const { id } = await params
  const detail = await getBookDetail(id)
  if (!detail) return { title: 'Ном олдсонгүй' }
  const { book } = detail.listing
  return {
    title: book.title,
    description: book.description ?? undefined,
    openGraph: {
      title: book.title,
      description: book.description ?? undefined,
      type: 'article',
    },
  }
}

export default async function BookDetailPage({ params }: PageProps<'/books/[id]'>) {
  const { id } = await params
  const detail = await getBookDetail(id)
  if (!detail) notFound()

  const { listing, copies } = detail
  const { book } = listing
  const me = await getSessionUser()
  const alreadyWished = me ? await hasOpenRequestFor(book.id) : false
  const [reviews, myReview] = await Promise.all([
    getReviewsForBook(book.id, me?.id ?? null),
    getMyReview(book.id, me?.id ?? null),
  ])

  return (
    <div className="container">
      <nav className={styles.crumbs}>
        <Link href="/">Нүүр</Link> <span>/</span> <Link href="/search">Ном</Link>{' '}
        <span>/</span> <span className={styles.crumbCurrent}>{book.title}</span>
      </nav>

      <div className={styles.top}>
        <div className={styles.coverCol}>
          <BookCover
            title={book.title}
            author={book.author}
            color={book.coverColor}
            src={book.coverUrl}
            size="lg"
          />
        </div>

        <div className={styles.info}>
          <h1 className={styles.title}>{book.title}</h1>
          {book.author && <p className={styles.author}>{book.author}</p>}

          <div className={styles.badges}>
            {listing.avgRating !== null && (
              <Badge tone="warn">
                ★ {listing.avgRating.toFixed(1)} · {listing.reviewCount} сэтгэгдэл
              </Badge>
            )}
            {listing.availableCopies > 0 ? (
              <Badge tone="ok">{listing.availableCopies} хувь боломжтой</Badge>
            ) : (
              <Badge tone="danger">Одоогоор боломжгүй</Badge>
            )}
            {book.language && (
              <Badge>
                {book.language === 'mn' ? 'Монгол' : book.language === 'en' ? 'Англи' : book.language}
              </Badge>
            )}
          </div>

          {me && (
            <div className={styles.actionRow}>
              <WishlistButton
                bookId={book.id}
                title={book.title}
                author={book.author}
                alreadyRequested={alreadyWished}
                variant="icon"
              />
              <ReportButton entityType="book" entityId={book.id} variant="icon" />
            </div>
          )}

          {book.description && <p className={styles.desc}>{book.description}</p>}

          <dl className={styles.facts}>
            {book.publisher && (
              <>
                <dt>Хэвлэлийн газар</dt>
                <dd>{book.publisher}</dd>
              </>
            )}
            {book.publishedAt && (
              <>
                <dt>Хэвлэсэн он</dt>
                <dd>{book.publishedAt.slice(0, 4)}</dd>
              </>
            )}
            {book.isbn && (
              <>
                <dt>ISBN</dt>
                <dd className={styles.mono}>{book.isbn}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Энэ номын хувьнууд</h2>
        <p className={styles.sectionDesc}>
          Хувийг дарж дэлгэрэнгүй харж, солилцоо санал болгоорой.
        </p>

        {copies.length === 0 ? (
          <p className={styles.noCopies}>Одоогоор энэ номын хувь байхгүй байна.</p>
        ) : (
          <ul className={styles.copyGrid}>
            {copies.map((copy) => (
              <li key={copy.id}>
                <CopyCard
                  copy={copy}
                  bookId={book.id}
                  isMine={me?.id === copy.owner?.id}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReviewSection
        bookId={book.id}
        reviews={reviews}
        myReview={myReview}
        canReview={Boolean(me)}
      />
    </div>
  )
}

type CopyItem = {
  id: string
  condition: BookCondition
  conditionNote: string | null
  status: string
  transferCount: number
  owner: { id: string; username: string; displayName: string; city: string | null } | null
  images: { id: string; url: string; sortOrder: number }[]
}

function CopyCard({ copy, bookId, isMine }: { copy: CopyItem; bookId: string; isMine: boolean }) {
  const available = copy.status === 'available'
  return (
    <Link href={`/books/${bookId}/copies/${copy.id}`} className={styles.copyCard} data-preview>
      {copy.images.length > 0 ? (
        <div className={styles.copyThumb}>
          <Image src={copy.images[0].url} alt="" fill sizes="(max-width: 560px) 120px, 150px" />
        </div>
      ) : (
        <span className={styles.copyEmptyThumb} aria-hidden="true">—</span>
      )}

      <div className={styles.copyCardBody}>
        <div className={styles.tags}>
          <span className={styles.tag}>{CONDITION_LABEL[copy.condition]}</span>
          <span className={styles.statusPill} data-ok={available}>
            {available ? 'Боломжтой' : 'Захиалагдсан'}
          </span>
        </div>

        <span className={styles.copyOwner}>
          <span className={styles.avatar} aria-hidden="true">
            {copy.owner?.displayName.charAt(0)}
          </span>
          <span className={styles.ownerName}>
            {copy.owner?.displayName}
            {isMine && <span className={styles.you}>та</span>}
          </span>
        </span>

        <span className={styles.copyCity}>
          {copy.owner?.city ? `📍 ${copy.owner.city}` : 'Байршил заагаагүй'}
        </span>

        {copy.transferCount > 0 && (
          <span className={styles.copyTransfers}>{copy.transferCount} удаа солигдсон</span>
        )}
        {copy.conditionNote && <span className={styles.copyNote}>{copy.conditionNote}</span>}
      </div>
    </Link>
  )
}

import Image from 'next/image'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { BookCover } from '@/components/BookCard'
import { Badge, ButtonLink } from '@/components/ui'
import { OfferSwapForm } from '@/features/swaps/OfferSwapForm'
import { getOfferableCopies } from '@/features/swaps/queries'
import { ImageUploader } from '@/features/images/ImageUploader'
import { WishlistButton } from '@/features/wishlist/WishlistButton'
import { hasOpenRequestFor } from '@/features/wishlist/queries'
import { getBookDetail } from '@/features/books/queries'
import { getSessionUser } from '@/lib/auth/dal'
import { CONDITION_LABEL, COPY_STATUS_LABEL } from '@/types/domain'
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
  const offerable = me ? await getOfferableCopies(me.id) : []
  const alreadyWished = me ? await hasOpenRequestFor(book.id) : false

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
            <div className={styles.wishRow}>
              <WishlistButton
                bookId={book.id}
                title={book.title}
                author={book.author}
                alreadyRequested={alreadyWished}
              />
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
        <div className={styles.copies}>
          {copies.map((copy) => {
            const isMine = me?.id === copy.owner?.id
            const swappable = copy.status === 'available' && !isMine
            return (
              <div key={copy.id} className={styles.copy}>
                <div className={styles.copyMain}>
                  <div className={styles.copyOwner}>
                    <span className={styles.avatar} aria-hidden="true">
                      {copy.owner?.displayName.charAt(0)}
                    </span>
                    <div>
                      <span className={styles.ownerName}>{copy.owner?.displayName}</span>
                      {isMine && <span className={styles.you}>та</span>}
                      <p className={styles.ownerCity}>{copy.owner?.city ?? '—'}</p>
                    </div>
                  </div>
                  <div className={styles.copyMeta}>
                    <Badge tone="accent">{CONDITION_LABEL[copy.condition]}</Badge>
                    <Badge tone={copy.status === 'available' ? 'ok' : 'neutral'}>
                      {COPY_STATUS_LABEL[copy.status]}
                    </Badge>
                    {copy.transferCount > 0 && <Badge>{copy.transferCount} удаа солигдсон</Badge>}
                  </div>
                </div>

                {copy.conditionNote && <p className={styles.note}>{copy.conditionNote}</p>}

                {isMine ? (
                  <ImageUploader copyId={copy.id} images={copy.images} />
                ) : copy.images.length > 0 ? (
                  <ul className={styles.copyImages}>
                    {copy.images.map((img) => (
                      <li key={img.id}>
                        <Image src={img.url} alt="" width={74} height={111} />
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className={styles.copyAction}>
                  {isMine ? (
                    <ButtonLink href="/my-books" variant="secondary">
                      Миний ном
                    </ButtonLink>
                  ) : !me ? (
                    <ButtonLink href={`/login?next=/books/${book.id}`} variant="secondary">
                      Солилцохын тулд нэвтэрнэ үү
                    </ButtonLink>
                  ) : swappable ? (
                    <OfferSwapForm
                      requestedCopyId={copy.id}
                      offerable={offerable.filter((o) => o.copyId !== copy.id)}
                    />
                  ) : (
                    <button className={styles.disabled} disabled>
                      {copy.status === 'reserved' ? 'Өөр солилцоонд захиалагдсан' : 'Боломжгүй'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

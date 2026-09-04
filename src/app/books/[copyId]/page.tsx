import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { Avatar } from '@/components/Avatar'
import { Badge } from '@/components/ui'
import { ListingMenu } from '@/features/books/ListingMenu'
import { ReopenListingButton } from '@/features/books/ReopenListingButton'
import { findListingIdForBook, getListing } from '@/features/books/queries'
import { ImageUploader } from '@/features/images/ImageUploader'
import { ReportButton } from '@/features/moderation/ReportButton'
import { CommentSection } from '@/features/comments/CommentSection'
import { getComments } from '@/features/comments/queries'
import { OfferSwapForm } from '@/features/swaps/OfferSwapForm'
import { getOfferableCopies } from '@/features/swaps/queries'
import { getSessionUser } from '@/lib/auth/dal'
import { CONDITION_LABEL, COPY_STATUS_LABEL } from '@/types/domain'
import { CopyCarousel } from './CopyCarousel'
import styles from './page.module.css'

/**
 * One listing: this person's book, offered for swap.
 *
 * There is no page for "the book" behind it. Two people listing the same title
 * get two of these, and nothing on the site claims they are the same thing —
 * recognising that is a later feature (ADR-030).
 *
 * generateMetadata and the page both need the row; cache() makes that one query
 * per request rather than two.
 */
const load = cache(getListing)

const LANGUAGE_LABEL: Record<string, string> = { mn: 'Монгол', en: 'Англи', ru: 'Орос' }

export async function generateMetadata({ params }: PageProps<'/books/[copyId]'>) {
  const listing = await load((await params).copyId)
  if (!listing) return { title: 'Ном олдсонгүй' }
  return {
    title: listing.title,
    description: listing.description ?? undefined,
    openGraph: {
      title: listing.title,
      description: listing.description ?? undefined,
      type: 'article',
    },
  }
}

export default async function ListingPage({ params }: PageProps<'/books/[copyId]'>) {
  const { copyId } = await params
  const listing = await load(copyId)

  // Links minted before listings had their own URLs — and the notification rows
  // the database writes with entity_type 'book' — carry a books id. Send those
  // to a real listing instead of a 404.
  if (!listing) {
    const fallback = await findListingIdForBook(copyId)
    if (fallback) redirect(`/books/${fallback}`)
    notFound()
  }

  const me = await getSessionUser()
  const isMine = me?.id === listing.owner?.id
  const [offerable, comments] = await Promise.all([
    me && !isMine ? getOfferableCopies(me.id) : Promise.resolve([]),
    getComments({ listingId: listing.copyId }, me?.id ?? null),
  ])

  return (
    <div className="container">
      <nav className={styles.crumbs}>
        <Link href="/">Нүүр</Link> <span>/</span>
        <Link href="/search">Номнууд</Link> <span>/</span>
        <span className={styles.crumbCurrent}>{listing.title}</span>
      </nav>

      <div className={styles.layout}>
        <aside className={styles.media}>
          {isMine ? (
            <div className={styles.uploadBox}>
              <h2 className={styles.sectionTitle}>Зураг</h2>
              <ImageUploader copyId={listing.copyId} images={listing.images} />
            </div>
          ) : (
            <CopyCarousel images={listing.images} alt={listing.title} />
          )}
        </aside>

        <div className={styles.content}>
          <div className={styles.top}>
            <div className={styles.headInfo}>
              <h1 className={styles.title}>{listing.title}</h1>
              {listing.author && <p className={styles.author}>{listing.author}</p>}

              <div className={styles.badges}>
                <Badge tone="accent">{CONDITION_LABEL[listing.condition]}</Badge>
                <Badge tone={listing.status === 'available' ? 'ok' : 'neutral'}>
                  {COPY_STATUS_LABEL[listing.status]}
                </Badge>
                {listing.language && (
                  <Badge>{LANGUAGE_LABEL[listing.language] ?? listing.language}</Badge>
                )}
                {listing.transferCount > 0 && (
                  <Badge>{listing.transferCount} удаа солигдсон</Badge>
                )}
              </div>

              {me && (
                <div className={styles.actionRow}>
                  {isMine ? (
                    <ListingMenu copyId={listing.copyId} status={listing.status} />
                  ) : (
                    <ReportButton entityType="book_copy" entityId={listing.copyId} variant="icon" />
                  )}
                </div>
              )}

              {listing.conditionNote && <p className={styles.note}>{listing.conditionNote}</p>}
              {listing.description && <p className={styles.desc}>{listing.description}</p>}
            </div>
          </div>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Эзэмшигч, мэдээлэл</h2>
            <div className={styles.infoCard}>
              <dl className={styles.facts}>
                <dt>Эзэмшигч</dt>
                <dd>
                  {listing.owner ? (
                    <Link href={`/u/${listing.owner.username}`} className={styles.ownerLink}>
                      <Avatar
                        name={listing.owner.displayName}
                        src={listing.owner.avatarUrl}
                        size={34}
                      />
                      <span>
                        <span className={styles.ownerName}>{listing.owner.displayName}</span>
                        {isMine && <span className={styles.you}>та</span>}
                        {listing.owner.city && (
                          <span className={styles.ownerCity}>{listing.owner.city}</span>
                        )}
                      </span>
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Нөхцөл</dt>
                <dd>{CONDITION_LABEL[listing.condition]}</dd>
                {listing.publisher && (
                  <>
                    <dt>Хэвлэлийн газар</dt>
                    <dd>{listing.publisher}</dd>
                  </>
                )}
                {listing.publishedAt && (
                  <>
                    <dt>Хэвлэсэн он</dt>
                    <dd>{listing.publishedAt.slice(0, 4)}</dd>
                  </>
                )}
                {listing.isbn && (
                  <>
                    <dt>ISBN</dt>
                    <dd className={styles.mono}>{listing.isbn}</dd>
                  </>
                )}
                <dt>Нэмсэн огноо</dt>
                <dd>{listing.createdAt}</dd>
              </dl>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Солилцоо</h2>
            <div className={styles.swapBox}>
              {isMine ? (
                listing.status === 'available' ? (
                  <p className={styles.unavailable}>
                    Энэ ном солилцоонд нээлттэй байна. Хэн нэгэн санал болгоход мэдэгдэнэ.
                  </p>
                ) : listing.status === 'reserved' ? (
                  <p className={styles.unavailable}>
                    Идэвхтэй солилцоонд түгжигдсэн.{' '}
                    <Link href="/swaps">Солилцоо хэсгээс</Link> үргэлжлүүлнэ үү.
                  </p>
                ) : (
                  <div className={styles.reopen}>
                    <p className={styles.unavailable}>
                      Энэ ном одоогоор солилцоонд байхгүй. Дахин санал болгож болно.
                    </p>
                    <ReopenListingButton copyId={listing.copyId} />
                  </div>
                )
              ) : !me ? (
                <Link href={`/login?next=/books/${listing.copyId}`} className={styles.mineLink}>
                  Солилцохын тулд нэвтэрнэ үү
                </Link>
              ) : listing.status === 'available' ? (
                <OfferSwapForm
                  requestedCopyId={listing.copyId}
                  offerable={offerable.filter((o) => o.copyId !== listing.copyId)}
                />
              ) : (
                <p className={styles.unavailable}>
                  {listing.status === 'reserved'
                    ? 'Энэ ном өөр солилцоонд захиалагдсан.'
                    : 'Энэ ном одоогоор солилцоонд боломжгүй.'}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      <CommentSection
        target={{ listingId: listing.copyId }}
        path={`/books/${listing.copyId}`}
        comments={comments}
        canComment={Boolean(me)}
        viewerId={me?.id ?? null}
      />
    </div>
  )
}

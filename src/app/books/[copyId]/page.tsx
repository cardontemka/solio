import { Fragment } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { Avatar } from '@/components/Avatar'
import { PinIcon } from '@/components/Icons'
import { Badge } from '@/components/ui'
import { ListingMenu } from '@/features/books/ListingMenu'
import { ReopenListingButton } from '@/features/books/ReopenListingButton'
import { BookCover } from '@/components/BookCard'
import { coverColorFor, findListingIdForBook, getListing } from '@/features/books/queries'
import { ImageUploader } from '@/features/images/ImageUploader'
import { ReportButton } from '@/features/moderation/ReportButton'
import { CommentSection } from '@/features/comments/CommentSection'
import { getComments } from '@/features/comments/queries'
import { OfferSwapForm } from '@/features/swaps/OfferSwapForm'
import { getOfferableCopies, getOpenOffers } from '@/features/swaps/queries'
import { ClaimList } from '@/features/claims/ClaimList'
import { getOpenClaimFor } from '@/features/claims/queries'
import { formatItemCode } from '@/lib/qrFormat'
import { ReleaseStoredButton } from '@/features/storage/ReleaseStoredButton'
import { getSessionUser } from '@/lib/auth/dal'
import {
  ATTRIBUTES_FOR,
  CATEGORY_LABEL,
  CONDITION_LABEL,
  COPY_STATUS_LABEL,
  ITEMS_LABEL,
  KIND_COPY,
  STORAGE_POINT_KIND_LABEL,
} from '@/types/domain'
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
  // "ном" or "пянз" — every sentence on this page that used to say the first
  // one was wrong on half the catalogue.
  const noun = KIND_COPY[listing.kind].one.toLowerCase()
  const [offerable, comments, offers, openClaim] = await Promise.all([
    me && !isMine ? getOfferableCopies(me.id) : Promise.resolve([]),
    getComments({ listingId: listing.copyId }, me?.id ?? null),
    getOpenOffers(listing.copyId),
    // Visible to the two people it concerns and nobody else — the RPC behind it
    // returns rows only for those two.
    me ? getOpenClaimFor(listing.copyId) : Promise.resolve(null),
  ])
  // Whoever is physically holding it is the only one who can say it has left.
  // The owner used to be able to set this from a dropdown, which made the one
  // claim this site makes — here is who has this book — a thing anybody could
  // assert about themselves.
  const iAmKeeping =
    listing.storedAt != null && me?.username === listing.storedAt.username
  const myOffer = me ? offers.find((o) => o.requesterId === me.id) : undefined

  return (
    <div className="container">
      <nav className={styles.crumbs}>
        <Link href="/">Нүүр</Link> <span>/</span>
        <Link href="/search">{ITEMS_LABEL}</Link> <span>/</span>
        <span className={styles.crumbCurrent}>{listing.title}</span>
      </nav>

      <div className={styles.layout}>
        <aside className={styles.media}>
          {isMine ? (
            <div className={styles.uploadBox}>
              <h2 className={styles.sectionTitle}>Зураг</h2>
              <ImageUploader copyId={listing.copyId} images={listing.images} />
            </div>
          ) : listing.images.length > 0 ? (
            <CopyCarousel images={listing.images} alt={listing.title} kind={listing.kind} />
          ) : (
            /* A listing with no photograph had an empty column here, while every
               card elsewhere on the site drew a generated cover for it. For a
               record it is also where the relief of the disc reads best. */
            <div className={styles.placeholder}>
              <BookCover
                title={listing.title}
                author={listing.author}
                color={listing.coverColor}
                size="lg"
                kind={listing.kind}
              />
              <p className={styles.placeholderNote}>Зураг оруулаагүй байна</p>
            </div>
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
                {listing.categories.map((c) => (
                  <Link key={c} href={`/search?category=${c}`} className={styles.categoryChip}>
                    {CATEGORY_LABEL[c]}
                  </Link>
                ))}
                {listing.language && (
                  <Badge>{LANGUAGE_LABEL[listing.language] ?? listing.language}</Badge>
                )}
                {listing.storedAt && (
                  <Badge tone="accent">
                    <PinIcon size={13} />
                    {listing.storedAt.name}-д хадгалуулсан
                  </Badge>
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
                    <dt>{KIND_COPY[listing.kind].publisher}</dt>
                    <dd>{listing.publisher}</dd>
                  </>
                )}
                {listing.publishedAt && (
                  <>
                    <dt>{listing.kind === 'vinyl' ? 'Гарсан он' : 'Хэвлэсэн он'}</dt>
                    <dd>{listing.publishedAt.slice(0, 4)}</dd>
                  </>
                )}
                {/* The kind's own fields, in the order ATTRIBUTES_FOR lists them.
                    Adding a field to that list puts it here with no edit. */}
                {ATTRIBUTES_FOR[listing.kind].map((field) => {
                  const value = listing.attributes[field.key]
                  if (value === undefined || value === '') return null
                  return (
                    <Fragment key={field.key}>
                      <dt>{field.label}</dt>
                      <dd>
                        {value}
                        {field.suffix ?? ''}
                      </dd>
                    </Fragment>
                  )
                })}
                {listing.sizeNote && (
                  <>
                    <dt>Хэмжээ</dt>
                    <dd>{listing.sizeNote}</dd>
                  </>
                )}
                {listing.weightG && (
                  <>
                    <dt>Жин</dt>
                    <dd>{listing.weightG} г</dd>
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
                {/* Where the thing physically is. Its own row rather than a line
                    under the owner, because for anybody planning to collect it
                    this is the address that matters. */}
                {listing.storedAt && (
                  <>
                    <dt>Хадгалж буй газар</dt>
                    <dd>
                      <Link
                        href={`/u/${listing.storedAt.username}`}
                        className={styles.storedLink}
                      >
                        {listing.storedAt.name}
                      </Link>
                      <span className={styles.storedWhere}>
                        {STORAGE_POINT_KIND_LABEL[listing.storedAt.kind]} ·{' '}
                        {listing.storedAt.district}, {listing.storedAt.city} ·{' '}
                        {listing.storedAt.address}
                      </span>
                      <span className={styles.storedSince}>
                        {listing.storedAt.since}-нээс хойш
                      </span>
                    </dd>
                  </>
                )}
              </dl>

              {iAmKeeping && <ReleaseStoredButton copyId={listing.copyId} />}
            </div>
          </section>

          {openClaim && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {openClaim.role === 'owner' ? 'Шийдвэрлэх хүсэлт' : 'Таны хүсэлт'}
              </h2>
              {openClaim.role === 'owner' && (
                <p className={styles.claimLead}>
                  Зөвшөөрснөөр{' '}
                  {openClaim.kind === 'storage'
                    ? 'энэ зүйл тухайн хадгалах цэгт бүртгэгдэнэ. Эзэмшил тань хэвээр.'
                    : openClaim.claimantPoint
                      ? `энэ зүйлийг «${openClaim.claimantPoint}»-д хандивлаж, та 1 оноо авна. Тэр онооороо дурын хадгалах цэгээс дурын ном авч болно.`
                      : 'эзэмшил нөгөө тал руу шилжинэ. Үүнийг буцаах боломжгүй.'}
                </p>
              )}
              <ClaimList claims={[openClaim]} />
            </section>
          )}

          {isMine && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Шошго, код</h2>
              <div className={styles.labelBox}>
                <div>
                  <p className={styles.labelCode}>{formatItemCode(listing.publicCode)}</p>
                  <p className={styles.labelHint}>
                    Энэ {noun} дээр наасан шошгыг уншуулбал хэн ч хаана байгааг нь харж,
                    хадгалж авсан эсвэл өөрийн болгон авснаа бүртгүүлж болно. Таны
                    зөвшөөрөлгүйгээр юу ч өөрчлөгдөхгүй.
                  </p>
                </div>
                <Link href={`/books/${listing.copyId}/label`} className={styles.labelLink}>
                  Шошго хэвлэх
                </Link>
              </div>
            </section>
          )}

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Солилцоо</h2>
            <div className={styles.swapBox}>
              {isMine ? (
                listing.status === 'available' ? (
                  <p className={styles.unavailable}>
                    Энэ {noun} солилцоонд нээлттэй байна. Хэн нэгэн санал болгоход мэдэгдэнэ.
                  </p>
                ) : listing.status === 'reserved' ? (
                  <p className={styles.unavailable}>
                    Идэвхтэй солилцоонд түгжигдсэн.{' '}
                    <Link href="/swaps">Солилцоо хэсгээс</Link> үргэлжлүүлнэ үү.
                  </p>
                ) : (
                  <div className={styles.reopen}>
                    <p className={styles.unavailable}>
                      Энэ {noun} одоогоор солилцоонд байхгүй. Дахин санал болгож болно.
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
                    ? `Энэ ${noun} өөр солилцоонд захиалагдсан.`
                    : `Энэ ${noun} одоогоор солилцоонд боломжгүй.`}
                </p>
              )}
            </div>

            {/* Public, and deliberately: a reader wants to know whether anybody
                is already waiting on this, and the person who offered wants to
                see that they did. Both used to be invisible — the swap rows are
                participant-only — so a listing three people were waiting on
                looked exactly like one nobody wanted. */}
            {offers.length > 0 && (
              <div className={styles.offers}>
                <h3 className={styles.offersTitle}>
                  Ирсэн санал ({offers.length})
                  {myOffer && <span className={styles.offersMine}>Та санал болгосон</span>}
                </h3>
                <ul className={styles.offerList}>
                  {offers.map((o) => (
                    <li key={o.swapId} className={styles.offerRow} data-mine={o.requesterId === me?.id}>
                      <Link href={`/books/${o.offeredCopyId}`} className={styles.offerThumb}>
                        <BookCover
                          title={o.title}
                          author={o.author}
                          color={coverColorFor(o.offeredCopyId)}
                          src={o.imageUrl}
                          size="sm"
                          kind={o.kind}
                        />
                      </Link>
                      <div className={styles.offerBody}>
                        <Link href={`/books/${o.offeredCopyId}`} className={styles.offerTitle}>
                          {o.title}
                        </Link>
                        <p className={styles.offerMeta}>
                          <Link href={`/u/${o.requesterUsername}`} className={styles.offerWho}>
                            {o.requesterName}
                          </Link>
                          {' · '}
                          {o.createdAt}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>

      <CommentSection
        subject={KIND_COPY[listing.kind].one.toLowerCase()}
        subjectOf={KIND_COPY[listing.kind].of.toLowerCase()}
        target={{ listingId: listing.copyId }}
        path={`/books/${listing.copyId}`}
        comments={comments}
        canComment={Boolean(me)}
        viewerId={me?.id ?? null}
      />
    </div>
  )
}

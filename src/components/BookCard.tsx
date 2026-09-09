import Image from 'next/image'
import Link from 'next/link'
import styles from './BookCard.module.css'
import type { Listing } from '@/features/books/queries'
import { CONDITION_LABEL, COPY_STATUS_LABEL } from '@/types/domain'

/**
 * Shows the owner's photo when there is one, and a generated placeholder
 * otherwise, so a listing without photos still reads as a book.
 *
 * `unoptimized`, and deliberately. Every photo is already resized and re-encoded
 * as JPEG in the browser before it is uploaded — 1600px for the book page, 480px
 * for the cards — so an optimizer has almost nothing left to do, and the bucket
 * charges nothing for serving them. What it would cost is the hosting plan's
 * image-transformation allowance, which is counted per source image and is the
 * first ceiling this site would have reached: two photos a book puts 500 books
 * at the free limit. Serving the bytes as they are removes that ceiling.
 */
export function BookCover({
  title,
  author,
  color,
  src,
  size = 'md',
  priority = false,
}: {
  title: string
  author: string | null
  color: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
  /**
   * Load this one eagerly. Set on the handful of covers that are above the fold:
   * one of them is the page's Largest Contentful Paint, and lazy-loading the
   * largest thing on screen delays the moment the page looks ready — which is
   * what Next warns about in the console.
   */
  priority?: boolean
}) {
  return (
    <div
      className={styles.cover}
      data-size={size}
      data-has-image={Boolean(src)}
      style={{ '--cover': color } as React.CSSProperties}
    >
      {src ? (
        <Image
          className={styles.coverImage}
          src={src}
          alt={title}
          fill
          sizes={size === 'lg' ? '240px' : size === 'sm' ? '74px' : '(max-width: 520px) 45vw, 180px'}
          priority={priority}
          unoptimized
        />
      ) : (
        <>
          <div className={styles.coverSpine} aria-hidden="true" />
          <div className={styles.coverText}>
            <span className={styles.coverTitle}>{title}</span>
            {author && <span className={styles.coverAuthor}>{author}</span>}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * One person's book, offered for swap. The owner is part of the card because
 * that is what distinguishes two listings of the same title — there is no
 * shared "book page" behind them.
 */
export function BookCard({
  listing,
  priority = false,
}: {
  listing: Listing
  priority?: boolean
}) {
  return (
    <Link href={`/books/${listing.copyId}`} className={styles.card}>
      <div className={styles.coverWrap}>
        <BookCover
          title={listing.title}
          author={listing.author}
          color={listing.coverColor}
          // The card is ~180px wide; the 480px copy covers it on a 2x screen.
          src={listing.images[0]?.thumbUrl}
          priority={priority}
        />
        {/* Only worth saying when it is not the ordinary case. */}
        {listing.status !== 'available' && (
          <span className={styles.status} data-status={listing.status}>
            {COPY_STATUS_LABEL[listing.status]}
          </span>
        )}
      </div>
      <div className={styles.body}>
        <h3 className={styles.title}>{listing.title}</h3>
        {listing.author && <p className={styles.author}>{listing.author}</p>}
        <div className={styles.meta}>
          <span className={styles.condition}>{CONDITION_LABEL[listing.condition]}</span>
          {listing.owner && (
            <span className={styles.owner}>
              {listing.owner.city ?? listing.owner.displayName}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export function BookGrid({
  listings,
  priorityCount = 0,
}: {
  listings: Listing[]
  /**
   * How many of the leading covers to load eagerly. Only the first grid on a
   * page should ask for any: marking every image priority is the same as marking
   * none, and it makes the browser fetch a screenful it may never show.
   */
  priorityCount?: number
}) {
  return (
    <div className={styles.grid}>
      {listings.map((l, i) => (
        <BookCard key={l.copyId} listing={l} priority={i < priorityCount} />
      ))}
    </div>
  )
}

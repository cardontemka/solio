import Image from 'next/image'
import Link from 'next/link'
import styles from './BookCard.module.css'
import type { Listing } from '@/features/books/queries'
import { CONDITION_LABEL, COPY_STATUS_LABEL } from '@/types/domain'

/**
 * Shows the owner's photo when there is one, and a generated placeholder
 * otherwise, so a listing without photos still reads as a book.
 *
 * next/image handles the format conversion and responsive sizing; next.config.ts
 * derives the allowed remote host from the same environment variable the storage
 * layer uses, so the two cannot drift.
 */
export function BookCover({
  title,
  author,
  color,
  src,
  size = 'md',
}: {
  title: string
  author: string | null
  color: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
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
export function BookCard({ listing }: { listing: Listing }) {
  return (
    <Link href={`/books/${listing.copyId}`} className={styles.card}>
      <div className={styles.coverWrap}>
        <BookCover
          title={listing.title}
          author={listing.author}
          color={listing.coverColor}
          src={listing.images[0]?.url}
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

export function BookGrid({ listings }: { listings: Listing[] }) {
  return (
    <div className={styles.grid}>
      {listings.map((l) => (
        <BookCard key={l.copyId} listing={l} />
      ))}
    </div>
  )
}

import Image from 'next/image'
import Link from 'next/link'
import styles from './BookCard.module.css'
import type { BookListing } from '@/types/domain'

/**
 * Shows the uploaded cover when there is one, and a generated placeholder
 * otherwise, so a book without images still reads as a book.
 *
 * next/image handles the format conversion and responsive sizing the brief
 * asks for; next.config.ts derives the allowed remote host from the same
 * environment variable the storage layer uses, so the two cannot drift.
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

function Stars({ rating }: { rating: number }) {
  const rounded = Math.round(rating)
  return (
    <span className={styles.stars} aria-label={`${rating.toFixed(1)} оноо`}>
      {'★★★★★'.slice(0, rounded)}
      <span className={styles.starsDim}>{'★★★★★'.slice(rounded)}</span>
    </span>
  )
}

export function BookCard({ listing }: { listing: BookListing }) {
  const { book, availableCopies, avgRating, reviewCount } = listing
  return (
    <Link href={`/books/${book.id}`} className={styles.card}>
      <BookCover
        title={book.title}
        author={book.author}
        color={book.coverColor}
        src={book.coverUrl}
      />
      <div className={styles.body}>
        <h3 className={styles.title}>{book.title}</h3>
        {book.author && <p className={styles.author}>{book.author}</p>}
        <div className={styles.meta}>
          {avgRating !== null ? (
            <span className={styles.rating}>
              <Stars rating={avgRating} />
              <span className={styles.count}>({reviewCount})</span>
            </span>
          ) : (
            <span className={styles.count}>Үнэлгээгүй</span>
          )}
          <span
            className={styles.avail}
            data-none={availableCopies === 0}
          >
            {availableCopies > 0 ? `${availableCopies} боломжтой` : 'Боломжгүй'}
          </span>
        </div>
      </div>
    </Link>
  )
}

export function BookGrid({ listings }: { listings: BookListing[] }) {
  return (
    <div className={styles.grid}>
      {listings.map((l) => (
        <BookCard key={l.book.id} listing={l} />
      ))}
    </div>
  )
}

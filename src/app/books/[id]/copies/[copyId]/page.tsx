import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui'
import { getBookCopyDetail } from '@/features/books/queries'
import { ImageUploader } from '@/features/images/ImageUploader'
import { OfferSwapForm } from '@/features/swaps/OfferSwapForm'
import { getOfferableCopies } from '@/features/swaps/queries'
import { getSessionUser } from '@/lib/auth/dal'
import { CONDITION_LABEL, COPY_STATUS_LABEL } from '@/types/domain'
import { CopyCarousel } from './CopyCarousel'
import styles from './page.module.css'

type Params = { id: string; copyId: string }

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const copyId = (await params).copyId
  const copy = await getBookCopyDetail(copyId)
  if (!copy) return { title: 'Хувь олдсонгүй' }
  return { title: `${copy.book.title} — хувь` }
}

export default async function BookCopyPage({ params }: { params: Promise<Params> }) {
  const { copyId } = await params
  const copy = await getBookCopyDetail(copyId)
  if (!copy) notFound()

  const me = await getSessionUser()
  const isMine = me?.id === copy.owner?.id
  const offerable = me ? await getOfferableCopies(me.id) : []

  return (
    <div className="container">
      <nav className={styles.crumbs}>
        <Link href="/">Нүүр</Link> <span>/</span>
        <Link href="/search">Ном</Link> <span>/</span>
        <Link href={`/books/${copy.book.id}`}>{copy.book.title}</Link> <span>/</span>
        <span className={styles.crumbCurrent}>Хувь</span>
      </nav>

      <div className={styles.layout}>
        <aside className={styles.media}>
          {isMine ? (
            <div className={styles.uploadBox}>
              <h2 className={styles.sectionTitle}>Зураг</h2>
              <ImageUploader copyId={copy.id} images={copy.images} />
            </div>
          ) : copy.images.length > 0 ? (
            <CopyCarousel images={copy.images} alt={copy.book.title} />
          ) : (
            <p className={styles.empty}>Энэ хувийн зураг байхгүй байна.</p>
          )}
        </aside>

        <div className={styles.content}>
          <div className={styles.top}>
            <div className={styles.headInfo}>
              <Link href={`/books/${copy.book.id}`} className={styles.bookLink}>
                <h1 className={styles.title}>{copy.book.title}</h1>
                {copy.book.author && <p className={styles.author}>{copy.book.author}</p>}
              </Link>

              <div className={styles.badges}>
                <Badge tone="accent">{CONDITION_LABEL[copy.condition]}</Badge>
                <Badge tone={copy.status === 'available' ? 'ok' : 'neutral'}>
                  {COPY_STATUS_LABEL[copy.status]}
                </Badge>
                {copy.transferCount > 0 && <Badge>{copy.transferCount} удаа солигдсон</Badge>}
              </div>

              {copy.conditionNote && <p className={styles.note}>{copy.conditionNote}</p>}
            </div>
          </div>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Эзэмшигч, мэдээлэл</h2>
            <div className={styles.infoCard}>
              <dl className={styles.facts}>
                <dt>Эзэмшигч</dt>
                <dd>
                  {copy.owner ? (
                    <span className={styles.owner}>
                      <span className={styles.avatar} aria-hidden="true">
                        {copy.owner.displayName.charAt(0)}
                      </span>
                      <span>
                        <span className={styles.ownerName}>{copy.owner.displayName}</span>
                        {isMine && <span className={styles.you}>та</span>}
                        {copy.owner.city && <span className={styles.ownerCity}>{copy.owner.city}</span>}
                      </span>
                    </span>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Нөхцөл</dt>
                <dd>{CONDITION_LABEL[copy.condition]}</dd>
                <dt>Төлөв</dt>
                <dd>{COPY_STATUS_LABEL[copy.status]}</dd>
                <dt>Нэмсэн огноо</dt>
                <dd>{copy.createdAt}</dd>
                {copy.transferCount > 0 && <dt>Солилцсон тоо</dt>}
                {copy.transferCount > 0 && <dd>{copy.transferCount} удаа</dd>}
              </dl>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Солилцоо</h2>
        <div className={styles.swapBox}>
          {isMine ? (
            <Link href="/my-books" className={styles.mineLink}>→ Миний номнууд руу</Link>
          ) : !me ? (
            <Link href={`/login?next=/books/${copy.book.id}/copies/${copy.id}`} className={styles.mineLink}>
              Солилцохын тулд нэвтэрнэ үү
            </Link>
          ) : copy.status === 'available' ? (
            <OfferSwapForm
              requestedCopyId={copy.id}
              offerable={offerable.filter((o) => o.copyId !== copy.id)}
            />
          ) : (
            <p className={styles.unavailable}>
              {copy.status === 'reserved'
                ? 'Энэ хувь өөр солилцоонд захиалагдсан.'
                : 'Энэ хувь одоогоор солилцоонд боломжгүй.'}
            </p>
          )}
        </div>
      </section>
        </div>
      </div>
    </div>
  )
}

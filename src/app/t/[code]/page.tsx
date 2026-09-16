import Link from 'next/link'
import { BookCover } from '@/components/BookCard'
import { PageHeader } from '@/components/ui'
import { ClaimForm } from '@/features/claims/ClaimForm'
import { ClaimList } from '@/features/claims/ClaimList'
import { findCopyByCode, getClaimOptions, getOpenClaimFor } from '@/features/claims/queries'
import { ConfirmReceipt } from '@/features/swaps/ConfirmReceipt'
import { getSwapReceiptForCode } from '@/features/swaps/queries'
import { coverColorFor } from '@/features/books/queries'
import { getSessionUser } from '@/lib/auth/dal'
import { formatItemCode } from '@/lib/qr'
import { COPY_STATUS_LABEL, KIND_COPY, type CopyStatus } from '@/types/domain'
import styles from './page.module.css'

export const metadata = {
  title: 'Зүйл таних',
  robots: { index: false, follow: false },
}

/**
 * Where a scanned label lands.
 *
 * The URL is short on purpose — it is inside a QR that gets printed small and
 * photographed in bad light, and every character is more dots to resolve.
 *
 * Readable signed out, because the person holding the book has not necessarily
 * got an account yet and "what is this and whose is it?" is a fair question to
 * answer before asking anyone to sign up.
 */
export default async function ScannedItemPage({ params }: PageProps<'/t/[code]'>) {
  const { code } = await params
  const [item, me] = await Promise.all([findCopyByCode(code), getSessionUser()])
  if (!item) {
    return (
      <div className="container">
        <PageHeader
          title="Ийм код олдсонгүй"
          subtitle={`«${formatItemCode(code.toUpperCase())}» гэсэн кодтой ном, пянз бүртгэлгүй байна.`}
        />
        <p className={styles.miss}>
          Кодоо дахин шалгана уу — 8 тэмдэгт, үсэг тоо хоёулаа орно.{' '}
          <Link href="/take">Гараар оруулах</Link>
        </p>
      </div>
    )
  }

  const isMine = me?.id === item.ownerId
  // Whose claim it is decides what this page is for. Without this the person who
  // just pressed the button was told "somebody has a pending claim on this" —
  // true, and it reads as though a stranger got there first.
  // A live swap outranks everything else this page can offer: the reader is
  // holding a book somebody is owed, and the only thing to do with it is say so.
  const receipt = me ? await getSwapReceiptForCode(item.code) : null
  const myClaim = me && item.hasOpenClaim ? await getOpenClaimFor(item.copyId) : null
  // What each button would cost this particular reader. Only asked when there
  // is a button to draw.
  const options =
    me && !isMine && !item.hasOpenClaim ? await getClaimOptions(item.code) : null
  const noun = KIND_COPY[item.kind].one

  return (
    <div className="container">
      <div className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.head}>
            <Link href={`/books/${item.copyId}`} className={styles.cover}>
              <BookCover
                title={item.title}
                author={item.author}
                color={coverColorFor(item.copyId)}
                src={item.imageUrl}
                size="md"
                kind={item.kind}
              />
            </Link>
            <div className={styles.headText}>
              <span className={styles.kind}>{noun}</span>
              <h1 className={styles.title}>
                <Link href={`/books/${item.copyId}`}>{item.title}</Link>
              </h1>
              {item.author && <p className={styles.author}>{item.author}</p>}
              <p className={styles.code}>{formatItemCode(item.code)}</p>
            </div>
          </div>

          <dl className={styles.facts}>
            <dt>Эзэмшигч</dt>
            <dd>
              <Link href={`/u/${item.ownerUsername}`}>{item.ownerName}</Link>
              {isMine && <span className={styles.you}>та</span>}
            </dd>
            <dt>Төлөв</dt>
            <dd>{COPY_STATUS_LABEL[item.status as CopyStatus] ?? item.status}</dd>
            {item.storedAtName && (
              <>
                <dt>Хадгалж буй</dt>
                <dd>{item.storedAtName}</dd>
              </>
            )}
          </dl>

          {receipt ? (
            <ConfirmReceipt code={item.code} receipt={receipt} />
          ) : myClaim ? (
            <div className={styles.claim}>
              <h2 className={styles.claimTitle}>
                {myClaim.role === 'owner' ? 'Шийдвэрлэх хүсэлт' : 'Таны хүсэлт'}
              </h2>
              <p className={styles.claimLead}>
                {myClaim.role === 'owner'
                  ? myClaim.kind === 'storage'
                    ? 'Зөвшөөрснөөр энэ зүйл тухайн хадгалах цэгт бүртгэгдэнэ. Эзэмшил тань хэвээр.'
                    : 'Зөвшөөрснөөр эзэмшил нөгөө тал руу шилжинэ.'
                  : 'Эзэмшигчид мэдэгдсэн. Тэр зөвшөөрөх хүртэл юу ч өөрчлөгдөхгүй.'}
              </p>
              <ClaimList claims={[myClaim]} />
            </div>
          ) : isMine ? (
            <p className={styles.mine}>
              Энэ бол таны {noun.toLowerCase()}.{' '}
              <Link href={`/books/${item.copyId}/label`}>Шошгыг нь дахин хэвлэх</Link>
            </p>
          ) : !me ? (
            <div className={styles.signin}>
              <p>Хадгалж авсан эсвэл өөрийн болгон авснаа бүртгүүлэхийн тулд нэвтэрнэ үү.</p>
              <Link
                className={styles.signinLink}
                href={`/login?next=${encodeURIComponent(`/t/${item.code}`)}`}
              >
                Нэвтрэх
              </Link>
            </div>
          ) : item.hasOpenClaim ? (
            <p className={styles.waiting}>
              Энэ зүйл дээр хүсэлт хүлээгдэж байна. Эзэмшигч хариу өгсний дараа дахин
              оролдож болно.
            </p>
          ) : (
            options && <ClaimForm code={item.code} title={item.title} options={options} />
          )}
        </div>
      </div>
    </div>
  )
}

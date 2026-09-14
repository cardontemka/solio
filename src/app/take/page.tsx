import Link from 'next/link'
import { PageHeader } from '@/components/ui'
import { CodeEntry } from '@/features/claims/CodeEntry'
import { listMyClaims } from '@/features/claims/queries'
import { ClaimList } from '@/features/claims/ClaimList'
import { requireUser } from '@/lib/auth/dal'
import styles from './page.module.css'

export const metadata = {
  title: 'Зүйл авах',
  robots: { index: false, follow: false },
}

/**
 * The other half of "Нэмэх": something already on Solio has come into your
 * hands, and this is where you say so.
 *
 * Signed in only, because a claim has to belong to somebody. The page a scanned
 * label opens (/t/<code>) is public, and tells anyone what they are holding.
 */
export default async function TakePage() {
  const me = await requireUser()
  const claims = await listMyClaims()
  const mine = claims.filter((c) => c.role === 'claimant')
  const isPoint = me.accountType === 'storage_point'

  return (
    <div className="container">
      <div className={styles.shell}>
        <PageHeader
          title="Зүйл авах"
          subtitle={
            isPoint
              ? 'Хадгалахаар авсан, эсвэл хандив болгон авсан ном, пянзыг шошгоор нь бүртгэнэ.'
              : 'Хэн нэгнээс авсан ном, пянзыг шошгон дээрх QR эсвэл кодоор нь бүртгэнэ.'
          }
        />

        {/* The balance belongs on the page where it is spent. A number in a
            menu somewhere would be a score; here it is the answer to "can I
            take this one?". */}
        {!isPoint && (
          <div className={styles.credits}>
            <span className={styles.creditCount}>{me.credits}</span>
            <div>
              <p className={styles.creditTitle}>
                {me.credits > 0 ? 'оноо байна' : 'оноо алга'}
              </p>
              <p className={styles.creditNote}>
                {me.credits > 0
                  ? 'Нэг оноогоор дурын хадгалах цэгээс дурын нэг ном, пянз авна.'
                  : 'Хадгалах цэгт нэг ном хандивлавал 1 оноо авна. Тэр онооороо дурын цэгээс дурын ном авч болно.'}
              </p>
            </div>
          </div>
        )}

        <CodeEntry />

        <div className={styles.how}>
          <h2 className={styles.howTitle}>Яаж ажилладаг вэ?</h2>
          <ol className={styles.steps}>
            <li>Шошгон дээрх QR-ыг уншуулах, эсвэл 8 тэмдэгт кодыг бичих.</li>
            <li>
              {isPoint
                ? '«Хадгалж авлаа» (эзэмшил хэвээр) эсвэл «Хандив болгон авлаа» (эзэмшил шилжиж, эзэмшигч 1 оноо авна) гэдгээс сонгох.'
                : 'Хэн нэгний ном бол «Өөрийн болгон авлаа», хадгалах цэгийн ном бол 1 оноогоор авах.'}
            </li>
            <li>Эзэмшигчид мэдэгдэл очиж, тэр зөвшөөрсний дараа л өөрчлөлт хийгдэнэ.</li>
          </ol>
          <p className={styles.note}>
            Өөрийн ном, пянздаа шошго хэвлэхийг хүсвэл{' '}
            <Link href="/my-books">миний цуглуулга</Link> хэсгээс тухайн зүйл рүүгээ орж
            «Шошго хэвлэх» дар.
          </p>
        </div>

        {mine.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.howTitle}>Миний илгээсэн хүсэлтүүд</h2>
            <ClaimList claims={mine} />
          </section>
        )}
      </div>
    </div>
  )
}

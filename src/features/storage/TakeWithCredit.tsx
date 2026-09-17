import Link from 'next/link'
import { formatItemCode } from '@/lib/qrFormat'
import type { StoragePoint } from '@/types/domain'
import styles from './TakeWithCredit.module.css'

/**
 * How a book that belongs to a storage point changes hands.
 *
 * Not by swapping: the venue is not a reader and has no use for the book you
 * would offer it. A donated book sits on that shelf for whoever comes with a
 * credit — so this panel replaces the swap form entirely and says the three
 * things somebody needs: where it is, what it costs, and what to do when they
 * get there.
 */
export function TakeWithCredit({
  point,
  code,
  credits,
  signedIn,
  isOwnPoint,
}: {
  point: StoragePoint | null
  code: string
  credits: number
  signedIn: boolean
  /** The venue looking at its own shelf. */
  isOwnPoint: boolean
}) {
  if (isOwnPoint) {
    return (
      <p className={styles.note}>
        Энэ бол таны хандиваар авсан зүйл. Оноотой хэрэглэгч ирж QR-ыг уншуулахад
        эзэмшил нь шилжинэ.
      </p>
    )
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.lead}>
        Энэ зүйл <strong>{point?.name ?? 'хадгалах цэг'}</strong>-д хандивлагдсан тул
        солилцох биш, <strong>1 оноогоор</strong> авна.
      </p>

      <ol className={styles.steps}>
        <li>
          {point ? (
            <>
              <Link href={`/u/${point.username}`}>{point.name}</Link> дээр очно —{' '}
              {point.district}, {point.city}.
            </>
          ) : (
            'Хадгалах цэг дээр очно.'
          )}
        </li>
        <li>
          Ном дээрх QR-ыг уншуулах, эсвэл кодыг нь бичих:{' '}
          <span className={styles.code}>{formatItemCode(code)}</span>
        </li>
        <li>Цэг зөвшөөрөхөд 1 оноо хасагдаж, эзэмшил тань болно.</li>
      </ol>

      {signedIn ? (
        <div className={styles.footer}>
          <span className={credits > 0 ? styles.have : styles.lack}>
            Танд {credits} оноо байна
          </span>
          <Link className={styles.action} href="/take">
            QR уншуулах
          </Link>
        </div>
      ) : (
        <div className={styles.footer}>
          <Link className={styles.action} href="/login">
            Нэвтрэх
          </Link>
        </div>
      )}

      {signedIn && credits < 1 && (
        <p className={styles.note}>
          Оноо алга. Хадгалах цэгт нэг ном хандивлавал 1 оноо авна — тэр онооороо
          дурын цэгээс дурын ном авч болно.
        </p>
      )}
    </div>
  )
}

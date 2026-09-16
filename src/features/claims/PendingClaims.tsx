import { getClaimsAwaitingMe } from './queries'
import { ClaimList } from './ClaimList'
import styles from './PendingClaims.module.css'

/**
 * Claims waiting on the viewer's word, at the top of their own pages.
 *
 * Not a tab and not a notification: a claim expires in three days and moves
 * somebody's book when it is answered, so it belongs where the owner already
 * goes rather than behind a bell they may not open. Renders nothing at all when
 * there is nothing to decide.
 */
export async function PendingClaims() {
  const claims = await getClaimsAwaitingMe()
  if (claims.length === 0) return null

  // A donation is the one kind that pays, and the owner is the one it pays. It
  // is worth saying at the top rather than leaving to a chip on a row.
  const donations = claims.filter((c) => c.kind === 'ownership' && c.claimantPoint).length

  return (
    <section className={styles.wrap}>
      <h2 className={styles.title}>
        Шийдвэрлэх хүсэлт{claims.length > 1 ? ` (${claims.length})` : ''}
      </h2>
      <p className={styles.lead}>
        Хэн нэгэн таны зүйлийг авсан гэж бүртгүүлсэн байна. Зөвшөөрснөөр байршил эсвэл
        эзэмшил нь шилжинэ.
      </p>
      {donations > 0 && (
        <p className={styles.reward}>
          <strong>
            {donations > 1 ? `${donations} хандив` : 'Хандив'} — зөвшөөрвөл{' '}
            {donations > 1 ? `${donations} оноо` : '1 оноо'} авна.
          </strong>{' '}
          Нэг оноогоор дурын хадгалах цэгээс дурын ном, пянз авна.
        </p>
      )}
      <ClaimList claims={claims} />
    </section>
  )
}

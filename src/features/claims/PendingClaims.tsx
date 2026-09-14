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

  return (
    <section className={styles.wrap}>
      <h2 className={styles.title}>
        Шийдвэрлэх хүсэлт{claims.length > 1 ? ` (${claims.length})` : ''}
      </h2>
      <p className={styles.lead}>
        Хэн нэгэн таны зүйлийг авсан гэж бүртгүүлсэн байна. Зөвшөөрснөөр байршил эсвэл
        эзэмшил нь шилжинэ.
      </p>
      <ClaimList claims={claims} />
    </section>
  )
}

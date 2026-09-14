import { STORAGE_POINT_KIND_LABEL, type StoragePoint } from '@/types/domain'
import styles from './StoragePointCard.module.css'

/**
 * A venue's premises, as the public sees them.
 *
 * Everything here answers one question — can I get there, and when? — so the
 * address, the hours and the telephone lead, and the prose comes last. The map
 * link is a plain search on the address rather than a pin: nobody has drawn
 * coordinates yet, and a search for a written Ulaanbaatar address lands close
 * enough to be worth the tap.
 */
export function StoragePointCard({
  point,
  storedCount,
}: {
  point: StoragePoint
  storedCount: number
}) {
  const mapQuery = encodeURIComponent(
    `${point.name}, ${point.address}, ${point.district}, ${point.city}`
  )

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.kind}>{STORAGE_POINT_KIND_LABEL[point.kind]}</span>
        <span className={styles.badge}>Хадгалах цэг</span>
        <span className={styles.count}>
          {storedCount > 0 ? `${storedCount} зүйл хадгалж байна` : 'Одоогоор хоосон'}
        </span>
      </div>

      <dl className={styles.facts}>
        <dt>Хаяг</dt>
        <dd>
          {point.city}, {point.district}
          <span className={styles.line}>{point.address}</span>
          {point.landmark && <span className={styles.landmark}>{point.landmark}</span>}
          <a
            className={styles.map}
            href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Газрын зураг дээр харах →
          </a>
        </dd>

        <dt>Ажиллах цаг</dt>
        <dd>{point.hours}</dd>

        <dt>Утас</dt>
        <dd>
          <a className={styles.phone} href={`tel:${point.phone.replace(/[^0-9+]/g, '')}`}>
            {point.phone}
          </a>
        </dd>

        {point.capacity != null && (
          <>
            <dt>Багтаамж</dt>
            <dd>{point.capacity} ном</dd>
          </>
        )}

        {point.website && (
          <>
            <dt>Холбоос</dt>
            <dd>
              <a
                className={styles.map}
                href={point.website}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {point.website.replace(/^https?:\/\//, '')}
              </a>
            </dd>
          </>
        )}
      </dl>

      {point.description && <p className={styles.desc}>{point.description}</p>}
    </section>
  )
}

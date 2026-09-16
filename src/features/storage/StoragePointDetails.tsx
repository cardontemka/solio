import type { StoragePoint } from '@/types/domain'
import styles from './StoragePointDetails.module.css'

/**
 * A venue's premises, in full.
 *
 * The page above this shows the two things somebody needs before they decide to
 * go — the district and the opening hours — and everything else lives here,
 * behind a disclosure they open when they are actually planning the trip.
 *
 * The map link is a plain search on the written address rather than a pin:
 * nobody has drawn coordinates yet, and a search for an Ulaanbaatar address
 * lands close enough to be worth the tap.
 */
export function StoragePointDetails({ point }: { point: StoragePoint }) {
  const mapQuery = encodeURIComponent(
    `${point.name}, ${point.address}, ${point.district}, ${point.city}`
  )

  return (
    <div className={styles.card}>
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

    </div>
  )
}

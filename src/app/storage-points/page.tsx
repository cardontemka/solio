import Link from 'next/link'
import { EmptyState, PageHeader } from '@/components/ui'
import { listStoragePointCards } from '@/features/storage/queries'
import { STORAGE_POINT_KIND_LABEL } from '@/types/domain'
import styles from './page.module.css'

export const metadata = {
  title: 'Хадгалах цэгүүд',
  description:
    'Ном, пянзаа хадгалуулж болох кафе, номын сан, дэлгүүрүүд — хаяг, ажиллах цаг, утас.',
}

/**
 * Every place that holds books for other people.
 *
 * A directory rather than a map: there are no coordinates yet, and a written
 * address with opening hours is what somebody actually needs to decide whether
 * they can get there this afternoon. Signed out too — the point of a public
 * shelf is that it is public.
 */
export default async function StoragePointsPage() {
  const points = await listStoragePointCards()

  return (
    <div className="container">
      <PageHeader
        title="Хадгалах цэгүүд"
        subtitle="Ном, пянзаа энд хадгалуулж, эсвэл хандивлаж болно."
      />

      {/* Two different things happen at the same counter, and the difference is
          worth stating before somebody walks in expecting the other one. */}
      <div className={styles.explain}>
        <div className={styles.explainCard}>
          <h2 className={styles.explainTitle}>Хадгалуулах</h2>
          <p className={styles.explainBody}>
            Ном тань таных хэвээр. Хоёр хүн уулзалгүйгээр солилцоход хэрэгтэй — нэг нь
            тавьж, нөгөө нь авна. Оноо байхгүй.
          </p>
        </div>
        <div className={styles.explainCard}>
          <h2 className={styles.explainTitle}>Хандивлах</h2>
          <p className={styles.explainBody}>
            Эзэмших эрхээ цэгт шилжүүлнэ. Хариуд нь <strong>1 оноо</strong> авах ба
            түүгээрээ дурын хадгалах цэгээс дурын ном, пянз авч болно.
          </p>
        </div>
      </div>

      {points.length === 0 ? (
        <EmptyState
          title="Одоогоор бүртгэлтэй цэг алга"
          description="Кафе, номын сан, дэлгүүр эрхэлдэг бол хадгалах цэг болж бүртгүүлээрэй."
          action={
            <Link className={styles.cta} href="/register">
              Хадгалах цэг бүртгүүлэх
            </Link>
          }
        />
      ) : (
        <>
          <ul className={styles.grid}>
            {points.map((p) => (
              <li key={p.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <Link href={`/u/${p.username}`} className={styles.name}>
                    {p.name}
                  </Link>
                  <span className={styles.kind}>{STORAGE_POINT_KIND_LABEL[p.kind]}</span>
                </div>

                <p className={styles.address}>
                  {p.city}, {p.district}
                  <span className={styles.line}>{p.address}</span>
                  {p.landmark && <span className={styles.landmark}>{p.landmark}</span>}
                </p>

                <dl className={styles.meta}>
                  <dt>Цаг</dt>
                  <dd>{p.hours}</dd>
                  <dt>Утас</dt>
                  <dd>
                    <a href={`tel:${p.phone.replace(/[^0-9+]/g, '')}`}>{p.phone}</a>
                  </dd>
                </dl>

                <Link href={`/u/${p.username}`} className={styles.holding}>
                  {p.storedCount > 0
                    ? `${p.storedCount} зүйл хадгалж байна →`
                    : 'Одоогоор хоосон →'}
                </Link>
              </li>
            ))}
          </ul>

          <p className={styles.footNote}>
            Кафе, номын сан, дэлгүүр эрхэлдэг бол{' '}
            <Link href="/register">хадгалах цэг болж бүртгүүлээрэй</Link>.
          </p>
        </>
      )}
    </div>
  )
}

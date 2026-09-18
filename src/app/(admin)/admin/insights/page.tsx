import Link from 'next/link'
import { getInterestStats } from '@/features/discovery/queries'
import { CATEGORY_LABEL, KIND_COPY, type ItemKind } from '@/types/domain'
import styles from '../admin.module.css'

export const metadata = { title: 'Сонирхол', robots: { index: false, follow: false } }

const WINDOWS = [7, 30, 90, 365]

/**
 * What people are looking for, in totals.
 *
 * Every column here is a count with nobody's name on it. The underlying rows
 * belong to the readers who made them and staff cannot read those — the three
 * functions behind this page group by the thing, never by the person, so the
 * question "what has this member been searching for" has no answer anywhere in
 * the admin area. That is deliberate and worth keeping.
 *
 * Ranked by how many different people, not by hits: one restless visitor
 * refreshing the same listing should not be able to set the top of the chart.
 */
export default async function InsightsPage({ searchParams }: PageProps<'/admin/insights'>) {
  const params = await searchParams
  const raw = Number(Array.isArray(params.days) ? params.days[0] : params.days)
  const days = WINDOWS.includes(raw) ? raw : 30
  const { searches, items, categories } = await getInterestStats(days, 20)

  return (
    <>
      <p className={styles.note}>
        Хамгийн их хайгдсан, дарагдсан зүйлс — <strong>хэн</strong> гэдэггүйгээр. Эрэмбэ нь
        нийт дарсан тоо биш, <strong>хэдэн өөр хүн</strong> гэдгээр: нэг хүн нэг зүйлийг арав
        дахин нээсэн нь арван хүн сонирхсонтой адилгүй.
      </p>

      <nav className={styles.nav}>
        {WINDOWS.map((w) => (
          <Link
            key={w}
            href={`/admin/insights?days=${w}`}
            className={styles.navLink}
            data-active={days === w}
          >
            {w} хоног
          </Link>
        ))}
      </nav>

      <h2 className={styles.sectionTitle}>Хамгийн их хайгдсан</h2>
      <div className={styles.tableWrap}>
        {searches.length === 0 ? (
          <p className={styles.empty}>Энэ хугацаанд хайлт бүртгэгдээгүй.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Хайлт</th>
                <th>Хүн</th>
                <th>Нийт</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {searches.map((s) => (
                <tr key={s.query}>
                  <td>{s.query}</td>
                  <td className={styles.mono}>{s.people}</td>
                  <td className={styles.mono}>{s.searches}</td>
                  <td className={styles.rowActions}>
                    <Link href={`/search?q=${encodeURIComponent(s.query)}`}>Хайлтыг үзэх</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className={styles.sectionTitle}>Хамгийн их нээгдсэн зүйлс</h2>
      <div className={styles.tableWrap}>
        {items.length === 0 ? (
          <p className={styles.empty}>Энэ хугацаанд нээлт бүртгэгдээгүй.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Нэр</th>
                <th>Төрөл</th>
                <th>Эзэмшигч</th>
                <th>Хүн</th>
                <th>Нийт</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.copyId}>
                  <td>
                    <Link href={`/books/${i.copyId}`}>{i.title}</Link>
                    {i.author && <span className={styles.muted}> · {i.author}</span>}
                  </td>
                  <td>{KIND_COPY[i.kind as ItemKind]?.one ?? i.kind}</td>
                  <td>{i.ownerName}</td>
                  <td className={styles.mono}>{i.people}</td>
                  <td className={styles.mono}>{i.views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className={styles.sectionTitle}>Хамгийн их дарагдсан ангилал</h2>
      <div className={styles.tableWrap}>
        {categories.length === 0 ? (
          <p className={styles.empty}>Энэ хугацаанд ангилал дарагдаагүй.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ангилал</th>
                <th>Хүн</th>
                <th>Нийт</th>
                <th>Одоо байгаа</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.category}>
                  <td>{CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ?? c.category}</td>
                  <td className={styles.mono}>{c.people}</td>
                  <td className={styles.mono}>{c.clicks}</td>
                  {/* Interest with nothing behind it is the useful number on
                      this page: it is a heading people click and find empty. */}
                  <td className={styles.mono} data-alert={c.available === 0}>
                    {c.available}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

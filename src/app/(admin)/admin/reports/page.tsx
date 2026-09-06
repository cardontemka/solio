import Link from 'next/link'
import { Badge } from '@/components/ui'
import { ReportActions } from '@/features/moderation/ActionButtons'
import { getReports } from '@/features/moderation/queries'
import styles from '../admin.module.css'

const TONE = {
  open: 'warn', reviewing: 'accent', resolved: 'ok', dismissed: 'neutral',
} as const

const LABEL = {
  open: 'Шинэ', reviewing: 'Хянаж байна', resolved: 'Шийдвэрлэсэн', dismissed: 'Хэрэгсээгүй',
} as const

/** What each report is about, in words rather than a table name. */
const ENTITY_LABEL: Record<string, string> = {
  book: 'Ном',
  book_copy: 'Ном',
  request: 'Хүсэлт',
  comment: 'Сэтгэгдэл',
  profile: 'Хэрэглэгч',
  swap: 'Солилцоо',
}

export default async function ReportsPage() {
  const reports = await getReports()
  if (reports.length === 0) {
    return <div className={styles.tableWrap}><p className={styles.empty}>Гомдол алга.</p></div>
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Төлөв</th><th>Шалтгаан</th><th>Зорилтот</th>
            <th>Мэдээлэгч</th><th>Огноо</th><th>Үйлдэл</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id}>
              <td><Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge></td>
              <td>
                {r.reason}
                {r.detail && <p className={styles.detail}>{r.detail}</p>}
                {r.resolutionNote && (
                  <p className={styles.muted}>Тэмдэглэл: {r.resolutionNote}</p>
                )}
              </td>
              <td>
                <span className={styles.muted}>{ENTITY_LABEL[r.entityType] ?? r.entityType}</span>
                <div>
                  {/* Every kind resolves to a page now. Deciding whether to hide
                      something without being able to open it was guesswork. */}
                  {r.targetHref ? (
                    <Link href={r.targetHref} target="_blank" rel="noopener">
                      {r.targetLabel ?? 'Нээж үзэх'} ↗
                    </Link>
                  ) : (
                    <span className={styles.mono}>{r.entityId.slice(0, 8)}… (устсан)</span>
                  )}
                </div>
              </td>
              <td>{r.reporterName}</td>
              <td className={styles.muted}>{r.createdAt}</td>
              <td>
                <ReportActions
                  id={r.id}
                  status={r.status}
                  entityType={r.entityType}
                  entityId={r.entityId}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

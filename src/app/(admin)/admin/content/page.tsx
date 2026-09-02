import Link from 'next/link'
import { Badge } from '@/components/ui'
import { ContentActions } from '@/features/moderation/ActionButtons'
import { getContent } from '@/features/moderation/queries'
import styles from '../admin.module.css'

const LABEL = { active: 'Идэвхтэй', hidden: 'Нуусан', removed: 'Устгасан' } as const
const TONE = { active: 'ok', hidden: 'warn', removed: 'danger' } as const

export default async function ContentPage() {
  const books = await getContent()

  return (
    <>
      <p className={styles.note}>
        Контент устгагдахгүй — төлөв нь л өөрчлөгдөнө. Тиймээс шийдвэрийг буцаах боломжтой ба
        өмчлөлийн түүх бүрэн хэвээр үлдэнэ.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Ном</th><th>Төлөв</th><th>Хувь</th><th>Нэмсэн</th><th>Үйлдэл</th></tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id}>
                <td>
                  <Link href={`/books/${b.id}`}>{b.title}</Link>
                  {b.author && <div className={styles.muted}>{b.author}</div>}
                </td>
                <td><Badge tone={TONE[b.moderationStatus]}>{LABEL[b.moderationStatus]}</Badge></td>
                <td>{b.copyCount}</td>
                <td className={styles.muted}>{b.createdAt}</td>
                <td><ContentActions bookId={b.id} status={b.moderationStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

import Link from 'next/link'
import { Badge } from '@/components/ui'
import { ContentActions } from '@/features/moderation/ActionButtons'
import { getContent } from '@/features/moderation/queries'
import { Pager } from '@/components/Pager'
import { pageFrom, splitPage } from '@/lib/paging'
import styles from '../admin.module.css'

const LABEL = { active: 'Идэвхтэй', hidden: 'Нуусан', removed: 'Устгасан' } as const
const TONE = { active: 'ok', hidden: 'warn', removed: 'danger' } as const

const PER_PAGE = 40

export default async function ContentPage({ searchParams }: PageProps<'/admin/content'>) {
  const params = await searchParams
  const info = pageFrom(params, PER_PAGE)
  const { items: books, hasMore } = splitPage(
    await getContent({ limit: info.fetch, offset: info.offset }),
    info
  )

  return (
    <>
      <p className={styles.note}>
        <strong>Нуух</strong> нь буцаах боломжтой — төлөв нь л өөрчлөгдөнө.
        <strong> Устгах</strong> нь мөрүүдийг болон зургийг нь бүрмөсөн арилгана; зөвхөн
        админ хийж чадах ба audit бичлэг л үлдэнэ.
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
      <Pager page={info.page} hasMore={hasMore} params={params} basePath="/admin/content" />
    </>
  )
}

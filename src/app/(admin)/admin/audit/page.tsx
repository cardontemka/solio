import { Badge } from '@/components/ui'
import { getAuditLog } from '@/features/moderation/queries'
import { Pager } from '@/components/Pager'
import { pageFrom, splitPage } from '@/lib/paging'
import styles from '../admin.module.css'

const PER_PAGE = 40

export default async function AuditPage({ searchParams }: PageProps<'/admin/audit'>) {
  const params = await searchParams
  const info = pageFrom(params, PER_PAGE)
  const { items: rows, hasMore } = splitPage(
    await getAuditLog({ limit: info.fetch, offset: info.offset }),
    info
  )

  return (
    <>
      <p className={styles.note}>
        Зөвхөн нэмэгддэг — засах, устгах боломжгүй нь database trigger-ээр хамгаалагдсан.
        <strong> Татгалзсан</strong> оролдлого мөн бүртгэгдэнэ: зөвхөн амжилтыг бүртгэдэг лог нь
        “хэн нэгэн оролдсон уу?” гэдэгт хариулж чадахгүй.
      </p>
      <div className={styles.tableWrap}>
        {rows.length === 0 ? (
          <p className={styles.empty}>Бичлэг алга.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Хугацаа</th><th>Хэн</th><th>Үйлдэл</th>
                <th>Зорилтот</th><th>Үр дүн</th><th>Дэлгэрэнгүй</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className={styles.mono}>{a.createdAt}</td>
                  <td>
                    {a.actorName ?? <span className={styles.muted}>—</span>}
                    {a.actorRole && <div className={styles.mono}>{a.actorRole}</div>}
                  </td>
                  <td className={styles.mono}>{a.action}</td>
                  <td>
                    <span className={styles.muted}>{a.entityType}</span>
                    <div className={styles.mono}>{a.entityId.slice(0, 8)}…</div>
                  </td>
                  <td>
                    <Badge tone={a.outcome === 'denied' ? 'danger' : 'ok'}>
                      {a.outcome === 'denied' ? 'Татгалзсан' : 'Амжилттай'}
                    </Badge>
                  </td>
                  <td className={styles.mono}>
                    {Object.keys(a.payload).length > 0
                      ? JSON.stringify(a.payload).slice(0, 70)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pager page={info.page} hasMore={hasMore} params={params} basePath="/admin/audit" />
    </>
  )
}

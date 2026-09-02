import { Badge } from '@/components/ui'
import { getAuditLog } from '@/features/moderation/queries'
import styles from '../admin.module.css'

export default async function AuditPage() {
  const rows = await getAuditLog(100)

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
    </>
  )
}

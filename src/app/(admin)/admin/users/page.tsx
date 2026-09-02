import Link from 'next/link'
import { Badge } from '@/components/ui'
import { UserActions } from '@/features/moderation/ActionButtons'
import { getStaffRoles, getUsers } from '@/features/moderation/queries'
import styles from '../admin.module.css'

export default async function UsersPage() {
  const [users, myRoles] = await Promise.all([getUsers(), getStaffRoles()])
  const viewerIsAdmin = myRoles.includes('admin')

  return (
    <>
      <p className={styles.note}>
        Email болон утас энд <strong>харагдахгүй</strong> — тэдгээр нь `auth.users`-д үлддэг ба
        нээлттэй schema-д огт байхгүй. Дэмжлэгийн зорилгоор унших нь тусдаа, audit хийгддэг зам.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Хэрэглэгч</th><th>Эрх</th><th>Төлөв</th>
              <th>Ном</th><th>Бүртгүүлсэн</th><th>Үйлдэл</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/u/${u.username}`}>{u.displayName}</Link>
                  <div className={styles.mono}>@{u.username}</div>
                  {u.city && <div className={styles.muted}>{u.city}</div>}
                </td>
                <td>
                  {u.roles.filter((r) => r !== 'user').length === 0 ? (
                    <span className={styles.muted}>—</span>
                  ) : (
                    u.roles
                      .filter((r) => r !== 'user')
                      .map((r) => <Badge key={r} tone="accent">{r}</Badge>)
                  )}
                </td>
                <td>
                  <Badge tone={u.accountStatus === 'active' ? 'ok' : 'danger'}>
                    {u.accountStatus === 'active' ? 'Идэвхтэй'
                      : u.accountStatus === 'suspended' ? 'Түдгэлзүүлсэн' : 'Устгасан'}
                  </Badge>
                </td>
                <td>{u.copyCount}</td>
                <td className={styles.muted}>{u.joinedAt}</td>
                <td>
                  <UserActions
                    userId={u.id}
                    accountStatus={u.accountStatus}
                    roles={u.roles}
                    viewerIsAdmin={viewerIsAdmin}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

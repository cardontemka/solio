import Link from 'next/link'
import { getAdminCounts, getStaffRoles } from '@/features/moderation/queries'
import styles from './admin.module.css'

export default async function AdminDashboard() {
  const [counts, roles] = await Promise.all([getAdminCounts(), getStaffRoles()])
  const isAdmin = roles.includes('admin')

  return (
    <>
      <div className={styles.stats}>
        <Link href="/admin/reports" className={styles.stat} data-alert={counts.openReports > 0}>
          <div className={styles.statValue}>{counts.openReports}</div>
          <div className={styles.statLabel}>Хүлээгдэж буй гомдол</div>
        </Link>
        <Link href="/admin/users" className={styles.stat}>
          <div className={styles.statValue}>{counts.users}</div>
          <div className={styles.statLabel}>Хэрэглэгч</div>
        </Link>
        <Link href="/admin/content" className={styles.stat}>
          <div className={styles.statValue}>{counts.books}</div>
          <div className={styles.statLabel}>Ном</div>
        </Link>
        <div className={styles.stat}>
          <div className={styles.statValue}>{counts.swaps}</div>
          <div className={styles.statLabel}>Солилцоо</div>
        </div>
      </div>

      <p className={styles.note}>
        Таны эрх: <strong>{isAdmin ? 'admin' : 'moderator'}</strong>.{' '}
        {isAdmin
          ? 'Та контент модерацлах болон хэрэглэгчийн эрх өөрчлөх боломжтой.'
          : 'Та контент модерацлах боломжтой. Эрх өөрчлөх нь зөвхөн админд нээлттэй.'}
      </p>
    </>
  )
}

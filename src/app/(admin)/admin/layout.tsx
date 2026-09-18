import { notFound } from 'next/navigation'
import Link from 'next/link'
import { isStaff } from '@/features/moderation/queries'
import styles from './admin.module.css'

export const metadata = {
  title: 'Админ',
  robots: { index: false, follow: false },
}

const NAV = [
  { href: '/admin', label: 'Тойм' },
  { href: '/admin/reports', label: 'Гомдол' },
  { href: '/admin/users', label: 'Хэрэглэгч' },
  { href: '/admin/content', label: 'Контент' },
  { href: '/admin/insights', label: 'Сонирхол' },
  { href: '/admin/audit', label: 'Audit log' },
]

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  // Controls what is RENDERED. Every action re-checks the role in the database,
  // because this gate does not extend to the Server Actions used inside.
  // notFound() rather than a 403: the admin area simply does not exist for
  // anyone else, which reveals nothing about its shape.
  if (!(await isStaff())) notFound()

  return (
    <div className="container">
      <div className={styles.head}>
        <h1 className={styles.title}>Админ</h1>
        <p className={styles.subtitle}>
          Үйлдэл бүр audit log-д бүртгэгдэнэ — татгалзсан оролдлого ч мөн адил.
        </p>
      </div>

      <nav className={styles.nav}>
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className={styles.navLink}>
            {item.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  )
}

import Link from 'next/link'
import { LoginForm } from '@/features/users/LoginForm'
import styles from '@/components/forms.module.css'

export const metadata = {
  title: 'Нэвтрэх',
  robots: { index: false, follow: false },
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next } = await searchParams
  return (
    <div className="container">
      <div className={styles.authShell}>
        <div className={styles.authCard}>
          <h1 className={styles.authTitle}>Нэвтрэх</h1>
          <p className={styles.authSubtitle}>Solio дансаараа нэвтэрнэ үү.</p>

          <LoginForm next={typeof next === 'string' ? next : undefined} />

          <p className={styles.demoHint}>
            Туршилтын данс: <code>altan@example.invalid</code> / <code>demo1234</code>
          </p>

          <p className={styles.authAlt}>
            Данс байхгүй юу? <Link href="/register">Бүртгүүлэх</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { GoogleButton } from '@/features/users/GoogleButton'
import { RegisterForm } from '@/features/users/RegisterForm'
import styles from '@/components/forms.module.css'

export const metadata = {
  title: 'Бүртгүүлэх',
  robots: { index: false, follow: false },
}

export default async function RegisterPage({ searchParams }: PageProps<'/register'>) {
  const { next } = await searchParams
  const nextPath = typeof next === 'string' ? next : undefined

  return (
    <div className="container">
      <div className={styles.authShell}>
        <div className={styles.authCard}>
          <h1 className={styles.authTitle}>Бүртгүүлэх</h1>
          <p className={styles.authSubtitle}>
            Ном, пянзаа бүртгэж солилцоо эхлүүлэх — эсвэл ном хадгалах цэгээ бүртгүүлэх.
          </p>

          <RegisterForm next={nextPath} />

          <div className={styles.divider}>эсвэл</div>
          <GoogleButton next={nextPath ?? '/dashboard'} />

          <p className={styles.authAlt}>
            Хаягтай юу?{' '}
            <Link href={nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login'}>
              Нэвтрэх
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { GoogleButton } from '@/features/users/GoogleButton'
import { LoginForm } from '@/features/users/LoginForm'
import styles from '@/components/forms.module.css'

export const metadata = {
  title: 'Нэвтрэх',
  robots: { index: false, follow: false },
}

/** Messages for the codes /api/auth/callback can redirect back with. */
const CALLBACK_ERROR: Record<string, string> = {
  provider: 'Нэвтрэх үйлчилгээ татгалзлаа. Дахин оролдоно уу.',
  missing_code: 'Баталгаажуулах холбоос бүрэн бус байна. Шинэ холбоос хүсэх шаардлагатай.',
  exchange:
    'Баталгаажуулах холбоосын хугацаа дууссан эсвэл аль хэдийн ашиглагдсан байна. Дахин илгээнэ үү.',
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next, error } = await searchParams
  const nextPath = typeof next === 'string' ? next : undefined
  const errorMessage = typeof error === 'string' ? CALLBACK_ERROR[error] : undefined

  return (
    <div className="container">
      <div className={styles.authShell}>
        <div className={styles.authCard}>
          <h1 className={styles.authTitle}>Нэвтрэх</h1>
          <p className={styles.authSubtitle}>Solio дансаараа нэвтэрнэ үү.</p>

          {errorMessage && (
            <p className={styles.formMessage} role="alert">
              {errorMessage}
            </p>
          )}

          <LoginForm next={nextPath} />

          <div className={styles.divider}>эсвэл</div>
          <GoogleButton next={nextPath ?? '/my-books'} />

          <p className={styles.authAlt}>
            Данс байхгүй юу? <Link href="/register">Бүртгүүлэх</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

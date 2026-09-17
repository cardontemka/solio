import Link from 'next/link'
import { AuthHashNotice } from '@/features/users/AuthHashNotice'
import { GoogleButton } from '@/features/users/GoogleButton'
import { LoginForm } from '@/features/users/LoginForm'
import styles from '@/components/forms.module.css'

export const metadata = {
  title: 'Нэвтрэх',
  robots: { index: false, follow: false },
}

/**
 * Messages for the codes /api/auth/callback can redirect back with.
 *
 * `missing_code` is deliberately quiet: the usual reason for arriving without
 * one is a link whose real complaint is in the URL fragment, which
 * AuthHashNotice reads and states precisely. Repeating a guess underneath it
 * would be two contradictory explanations of one failure.
 */
const CALLBACK_ERROR: Record<string, string> = {
  provider: 'Нэвтрэх үйлчилгээ татгалзлаа. Дахин оролдоно уу.',
  exchange:
    'Баталгаажуулах холбоосын хугацаа дууссан эсвэл аль хэдийн ашиглагдсан байна. Дахин илгээнэ үү.',
  other_origin:
    'Нэвтрэлт өөр хаягаас эхэлсэн тул энд дуусгаж чадсангүй. Эхлүүлсэн хаягаараа дахин ' +
    'оролдоно уу — асуудал давтагдвал Supabase → Authentication → URL Configuration дээр ' +
    'энэ хаягийг Redirect URLs-д нэмэх шаардлагатай.',
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
          <AuthHashNotice />
          <p className={styles.authSubtitle}>Solio хаягаараа нэвтэрнэ үү.</p>

          {errorMessage && (
            <p className={styles.formMessage} role="alert">
              {errorMessage}
            </p>
          )}

          <LoginForm next={nextPath} />

          <div className={styles.divider}>эсвэл</div>
          <GoogleButton next={nextPath ?? '/'} />

          <p className={styles.authAlt}>
            Хаяг байхгүй юу?{' '}
            <Link href={nextPath ? `/register?next=${encodeURIComponent(nextPath)}` : '/register'}>
              Бүртгүүлэх
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

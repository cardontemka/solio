import Link from 'next/link'
import { GoogleButton } from '@/features/users/GoogleButton'
import { RegisterForm } from '@/features/users/RegisterForm'
import styles from '@/components/forms.module.css'

export const metadata = {
  title: 'Бүртгүүлэх',
  robots: { index: false, follow: false },
}

export default function RegisterPage() {
  return (
    <div className="container">
      <div className={styles.authShell}>
        <div className={styles.authCard}>
          <h1 className={styles.authTitle}>Бүртгүүлэх</h1>
          <p className={styles.authSubtitle}>
            Номоо бүртгэж, солилцоо эхлүүлэхийн тулд данс үүсгэнэ үү.
          </p>

          <RegisterForm />

          <div className={styles.divider}>эсвэл</div>
          <GoogleButton />

          <p className={styles.authAlt}>
            Данстай юу? <Link href="/login">Нэвтрэх</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Link from 'next/link'
import { SiteHeader } from '@/components/SiteHeader'
import './globals.css'
import styles from './layout.module.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'cyrillic'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'Solio — Ном солилцох платформ',
    template: '%s · Solio',
  },
  description:
    'Уншсан номоо бусадтай солилцож, хүссэн номоо ол. Монголын анхны community-driven ном солилцооны платформ.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="mn" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <SiteHeader />
        <main className={styles.main}>{children}</main>
        <footer className={styles.footer}>
          <div className={`container ${styles.footerInner}`}>
            <span>© 2026 Solio</span>
            <nav className={styles.footerNav}>
              <Link href="/">Нүүр</Link>
              <Link href="/search">Хайх</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  )
}

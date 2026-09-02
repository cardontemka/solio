import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Geist, Geist_Mono } from 'next/font/google'
import Link from 'next/link'
import { SiteHeader } from '@/components/SiteHeader'
import { AddBookFab } from '@/components/AddBookFab'
import './globals.css'
import styles from './layout.module.css'
import { THEME_COOKIE, THEME_VALUES } from '@/components/theme'

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

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const store = await cookies()
  const theme = store.get(THEME_COOKIE)?.value
  const dataTheme = theme && THEME_VALUES.includes(theme as never) ? theme : undefined

  return (
    <html
      lang="mn"
      className={`${geistSans.variable} ${geistMono.variable}`}
      {...(dataTheme ? { 'data-theme': dataTheme } : {})}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=document.cookie.match(/(?:^|; )solio-theme=([^;]*)/);var t=c&&c[1];if(!t){t=localStorage.getItem('solio-theme');}if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <SiteHeader />
        <main className={styles.main}>{children}</main>
        <AddBookFab />
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

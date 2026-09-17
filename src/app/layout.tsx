import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { publicEnv } from '@/lib/validation/env'
import { Geist, Geist_Mono } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { CategoryBar } from '@/components/CategoryBar'
import { SiteHeader } from '@/components/SiteHeader'
import { SiteMobileNav } from '@/components/SiteMobileNav'
import { NavProgress } from '@/components/NavProgress'
import { AddBookFab } from '@/components/AddBookFab'
import './globals.css'
import styles from './layout.module.css'
import { THEME_COOKIE, THEME_VALUES } from '@/components/theme'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'cyrillic'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  // Every relative URL in a page's metadata — canonicals, Open Graph images —
  // resolves against this. Without it Next warns and emits relative og:url,
  // which crawlers and chat previews both mishandle.
  metadataBase: new URL(publicEnv.siteUrl),
  title: {
    default: 'Solio — Ном солилцох платформ',
    template: '%s · Solio',
  },
  description:
    'Уншсан номоо, сонссон пянзаа бусадтай солилцож, хайж байгаагаа ол. Монголын анхны community-driven солилцооны платформ.',
  openGraph: {
    type: 'website',
    siteName: 'Solio',
    locale: 'mn_MN',
    url: publicEnv.siteUrl,
  },
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
        {/* Runs before the bundle. Three jobs: set the theme attribute so the
            page does not flash the wrong colours; shim two APIs that browsers
            older than Chromium 93 lack, without which the bundle throws and
            nothing on the page responds to a tap; and, only when the URL
            carries ?debug, print errors into a panel on the page. A phone has
            no console you can open, and "nothing happens" is not a symptom
            anyone can act on. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=document.cookie.match(/(?:^|; )solio-theme=([^;]*)/);var t=c&&c[1];if(!t){t=localStorage.getItem('solio-theme');}if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}if(!Object.hasOwn){Object.hasOwn=function(o,k){return Object.prototype.hasOwnProperty.call(o,k);};}if(!Array.prototype.at){Object.defineProperty(Array.prototype,'at',{value:function(n){n=Math.trunc(n)||0;if(n<0)n+=this.length;return n<0||n>=this.length?undefined:this[n];},writable:true,configurable:true});}if(!String.prototype.at){Object.defineProperty(String.prototype,'at',{value:function(n){n=Math.trunc(n)||0;if(n<0)n+=this.length;return n<0||n>=this.length?undefined:this[n];},writable:true,configurable:true});}if(location.search.indexOf('debug')>-1){var box=null,n=0;var show=function(m){try{n++;if(!box){box=document.createElement('div');box.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;max-height:45vh;overflow:auto;background:#7f1d1d;color:#fff;font:12px/1.45 monospace;padding:10px 12px;white-space:pre-wrap;word-break:break-word';document.body.appendChild(box);}box.appendChild(document.createTextNode(n+'. '+m+'\\n'));}catch(e){}};addEventListener('error',function(ev){show((ev.message||'error')+' @ '+(ev.filename||'')+':'+(ev.lineno||0));},true);addEventListener('unhandledrejection',function(ev){show('promise: '+((ev.reason&&(ev.reason.message||ev.reason))||''));});var ce=console.error;console.error=function(){try{show('console: '+Array.prototype.slice.call(arguments).map(String).join(' ').slice(0,400));}catch(e){}return ce.apply(console,arguments);};addEventListener('DOMContentLoaded',function(){show('JS ажиллаж байна · UA: '+navigator.userAgent.slice(0,90));});}})();`,
          }}
        />
      </head>
      <body>
        <NavProgress />
        <SiteHeader />
        <CategoryBar />
        <main className={styles.main}>{children}</main>
        <AddBookFab />
        <SiteMobileNav />
        <footer className={styles.footer}>
          <div className={`container ${styles.footerInner}`}>
            <div className={styles.footerCol}>
              <span className={styles.footerBrand}>
                <Image
                  className={styles.footerMark}
                  src="/header-logo.png"
                  alt=""
                  width={48}
                  height={48}
                />
                © 2026 Solio
              </span>
              <nav className={styles.footerNav}>
                <Link href="/">Нүүр</Link>
                <Link href="/about">Бидний тухай</Link>
              </nav>
            </div>

            <div className={styles.footerCol}>
              <span className={styles.footerHeading}>Холбоо барих</span>
              <a href="mailto:ptemuulen82@gmail.com">ptemuulen82@gmail.com</a>
              <a href="tel:+97695859278">95859278</a>
              <a
                href="https://www.instagram.com/solio.mn/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Instagram
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}

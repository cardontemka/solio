import Link from 'next/link'
import { PageHeader } from '@/components/ui'
import styles from './not-found.module.css'

export const metadata = {
  title: 'Хуудас олдсонгүй',
  robots: { index: false, follow: false },
}

/**
 * The page for a URL that is not there.
 *
 * It was the framework's own black-and-white plate, which is a different site
 * for one screen: no header, no colours, English. This one is the site — the
 * shell is already around it, so all it has to do is say what happened and
 * offer the two or three places somebody probably meant to be.
 */
export default function NotFound() {
  return (
    <div className="container">
      <div className={styles.shell}>
        <span className={styles.code} aria-hidden="true">404</span>
        <PageHeader
          title="Ийм хуудас олдсонгүй"
          subtitle="Холбоос буруу бичигдсэн, эсвэл энэ зүйл устсан байж магадгүй."
        />

        <div className={styles.links}>
          <Link className={styles.primary} href="/">
            Нүүр хуудас
          </Link>
          <Link className={styles.secondary} href="/search">
            Ном, пянз хайх
          </Link>
          <Link className={styles.secondary} href="/storage-points">
            Хадгалах цэгүүд
          </Link>
        </div>

        <p className={styles.note}>
          QR уншуулаад энд ирсэн бол код нь бүрэн уншигдаагүй байж магадгүй —{' '}
          <Link href="/take">кодыг гараар бичиж</Link> үзнэ үү.
        </p>
      </div>
    </div>
  )
}

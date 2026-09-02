'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { logoutAction } from '@/features/users/actions'
import styles from './Header.module.css'

const PUBLIC_NAV = [
  { href: '/', label: 'Нүүр' },
  { href: '/search', label: 'Хайх' },
] as const

const PRIVATE_NAV = [
  { href: '/my-books', label: 'Миний номнууд' },
  { href: '/wishlist', label: 'Хүслийн жагсаалт' },
  { href: '/swaps', label: 'Солилцоо' },
  { href: '/notifications', label: 'Мэдэгдэл' },
] as const

export type HeaderUser = { displayName: string; username: string } | null

export function Header({ user, unreadCount = 0 }: { user: HeaderUser; unreadCount?: number }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.brand} onClick={() => setOpen(false)}>
          <span className={styles.mark} aria-hidden="true" />
          Solio
        </Link>

        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-label="Цэс"
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.bars} data-open={open} />
        </button>

        <nav className={styles.nav} data-open={open}>
          {[...PUBLIC_NAV, ...(user ? PRIVATE_NAV : [])].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.link}
              data-active={isActive(item.href)}
              onClick={() => setOpen(false)}
            >
              {item.label}
              {item.href === '/notifications' && unreadCount > 0 && (
                <span className={styles.badge} aria-label={`${unreadCount} уншаагүй`}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
          ))}
          <div className={styles.spacer} />
          {user ? (
            <>
              <Link
                href={`/u/${user.username}`}
                className={styles.login}
                onClick={() => setOpen(false)}
              >
                {user.displayName}
              </Link>
              <form action={logoutAction}>
                <button type="submit" className={styles.logout}>
                  Гарах
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className={styles.login} onClick={() => setOpen(false)}>
              Нэвтрэх
            </Link>
          )}
          <Link href="/books/new" className={styles.cta} onClick={() => setOpen(false)}>
            Ном нэмэх
          </Link>
        </nav>
      </div>
    </header>
  )
}

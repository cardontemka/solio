'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { logoutAction } from '@/features/users/actions'
import { ThemeToggle } from './ThemeToggle'
import {
  BellIcon,
  BookIcon,
  ChevronDownIcon,
  HeartIcon,
  LogOutIcon,
  SwapIcon,
  UserIcon,
} from './Icons'
import styles from './Header.module.css'

const NAV = [
  { href: '/', label: 'Нүүр' },
  { href: '/search', label: 'Explore' },
] as const

export type HeaderUser = { displayName: string; username: string } | null

export function Header({
  user,
  unreadCount = 0,
  isStaff = false,
}: {
  user: HeaderUser
  unreadCount?: number
  isStaff?: boolean
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  // Close the user menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

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
          {[
            ...NAV,
            ...(isStaff ? ([{ href: '/admin', label: 'Админ' }] as const) : []),
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.link}
              data-active={isActive(item.href)}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <div className={styles.spacer} />

          <div className={styles.actions}>
            <ThemeToggle />

            {user ? (
              <Link
                href="/notifications"
                className={styles.bell}
                data-active={pathname.startsWith('/notifications')}
                aria-label="Мэдэгдэл"
                onClick={() => setOpen(false)}
              >
                <BellIcon size={20} />
                {unreadCount > 0 && (
                  <span className={styles.badge} aria-label={`${unreadCount} уншаагүй`}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
            ) : null}

            {user ? (
              <div className={styles.userWrap} ref={menuRef}>
                <button
                  type="button"
                  className={styles.userBtn}
                  data-open={menuOpen}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  aria-label="Хэрэглэгчийн цэс"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <span className={styles.avatar} aria-hidden="true">
                    <UserIcon size={17} />
                  </span>
                  <ChevronDownIcon size={14} className={styles.chevron} />
                </button>

                {menuOpen && <Menu user={user} onNavigate={() => setMenuOpen(false)} />}
              </div>
            ) : (
              <Link href="/login" className={styles.login} onClick={() => setOpen(false)}>
                Нэвтрэх
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  )
}

function Menu({
  user,
  onNavigate,
}: {
  user: HeaderUser
  onNavigate: () => void
}) {
  return (
    <div className={styles.menu}>
      <div className={styles.menuHead}>
        <p className={styles.menuName}>{user?.displayName}</p>
        <p className={styles.menuUser}>@{user?.username}</p>
      </div>
      <Link href={`/u/${user?.username}`} className={styles.menuItem} onClick={onNavigate}>
        <UserIcon size={17} />
        Профайл
      </Link>
      <Link href="/my-books" className={styles.menuItem} onClick={onNavigate}>
        <BookIcon size={17} />
        Миний номнууд
      </Link>
      <Link href="/wishlist" className={styles.menuItem} onClick={onNavigate}>
        <HeartIcon size={17} />
        Хүслийн жагсаалт
      </Link>
      <Link href="/swaps" className={styles.menuItem} onClick={onNavigate}>
        <SwapIcon size={17} />
        Солилцоо
      </Link>
      <div className={styles.menuDivider} role="separator">
        <form action={logoutAction}>
          <button type="submit" className={styles.menuItem}>
            <LogOutIcon size={17} />
            Гарах
          </button>
        </form>
      </div>
    </div>
  )
}

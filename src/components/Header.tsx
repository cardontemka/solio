'use client'

import Link from 'next/link'
import { Avatar } from './Avatar'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { logoutAction } from '@/features/users/actions'
import { ThemeMenuItem } from './ThemeToggle'
import {
  BellIcon,
  BookIcon,
  ChevronDownIcon,
  LogOutIcon,
  SettingsIcon,
  SwapIcon,
  UserIcon,
} from './Icons'
import styles from './Header.module.css'

const NAV = [
  { href: '/', label: 'Нүүр' },
  { href: '/search', label: 'Номнууд' },
  { href: '/requests', label: 'Ном хүсэх' },
] as const

export type HeaderUser = { displayName: string; username: string; avatarUrl: string | null } | null

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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  const navItems = [
    ...NAV,
    ...(isStaff ? ([{ href: '/admin', label: 'Админ' }] as const) : []),
  ]

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
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true" />
          Solio
        </Link>

        {/* Desktop only. On a phone these live inside the user menu, so the
            bar keeps just the two things people reach for: their messages and
            themselves. */}
        <nav className={styles.nav}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.link}
              data-active={isActive(item.href)}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.actions}>
          {user && (
            <Link
              href="/notifications"
              className={styles.bell}
              data-active={pathname.startsWith('/notifications')}
              aria-label="Мэдэгдэл"
            >
              <BellIcon size={20} />
              {unreadCount > 0 && (
                <span className={styles.badge} aria-label={`${unreadCount} уншаагүй`}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
          )}

          <div className={styles.userWrap} ref={menuRef}>
            <button
              type="button"
              className={styles.userBtn}
              data-open={menuOpen}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={user ? 'Хэрэглэгчийн цэс' : 'Цэс'}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {user ? (
                <Avatar name={user.displayName} src={user.avatarUrl} size={28} />
              ) : (
                <span className={styles.avatarFallback} aria-hidden="true">
                  <UserIcon size={17} />
                </span>
              )}
              <ChevronDownIcon size={14} className={styles.chevron} />
            </button>

            {menuOpen && (
              <Menu
                user={user}
                navItems={navItems}
                onNavigate={() => setMenuOpen(false)}
              />
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

function Menu({
  user,
  navItems,
  onNavigate,
}: {
  user: HeaderUser
  navItems: readonly { href: string; label: string }[]
  onNavigate: () => void
}) {
  return (
    <div className={styles.menu} role="menu">
      {user && (
        <div className={styles.menuHead}>
          <p className={styles.menuName}>{user.displayName}</p>
          <p className={styles.menuUser}>@{user.username}</p>
        </div>
      )}

      {/* The bar drops its links on a phone; they reappear here rather than
          behind a second, separate menu button. */}
      <div className={styles.menuNav}>
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={styles.menuItem}
            onClick={onNavigate}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {user && (
        <>
          <Link href="/dashboard" className={styles.menuItem} onClick={onNavigate}>
            <UserIcon size={17} />
            Миний хуудас
          </Link>
          <Link href="/settings" className={styles.menuItem} onClick={onNavigate}>
            <SettingsIcon size={17} />
            Тохиргоо
          </Link>
          <Link href="/my-books" className={styles.menuItem} onClick={onNavigate}>
            <BookIcon size={17} />
            Миний номнууд
          </Link>
          <Link href="/swaps" className={styles.menuItem} onClick={onNavigate}>
            <SwapIcon size={17} />
            Солилцоо
          </Link>
        </>
      )}

      <div className={styles.menuDivider} role="separator">
        <ThemeMenuItem className={styles.menuItem} />

        {user ? (
          <form action={logoutAction}>
            <button type="submit" className={styles.menuItem}>
              <LogOutIcon size={17} />
              Гарах
            </button>
          </form>
        ) : (
          <>
            <Link href="/login" className={styles.menuItem} onClick={onNavigate}>
              <UserIcon size={17} />
              Нэвтрэх
            </Link>
            <Link href="/register" className={styles.menuItem} onClick={onNavigate}>
              <UserIcon size={17} />
              Бүртгүүлэх
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Avatar } from './Avatar'
import { SearchBar } from './SearchBar'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { logoutAction } from '@/features/users/actions'
import { ThemeMenuItem, ThemeToggle } from './ThemeToggle'
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
  const [navHidden, setNavHidden] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  // Come back to whatever they were reading. Auth pages are skipped so that
  // bouncing between login and register does not make one the other's target.
  const loginHref =
    pathname.startsWith('/login') || pathname.startsWith('/register')
      ? '/login'
      : `/login?next=${encodeURIComponent(pathname)}`

  const navItems = [
    ...NAV,
    ...(isStaff ? ([{ href: '/admin', label: 'Админ' }] as const) : []),
  ]

  // Hide the nav row when scrolling down, show it again on the way up.
  //
  // Measured against the position of the last toggle, not the last event.
  // Hiding the row shortens the sticky header, which nudges the scroll position
  // by about the row's height; compared against the previous event that reads
  // as a scroll in the opposite direction and the row oscillates, showing and
  // hiding itself several times a second. A threshold larger than that nudge
  // means only a real gesture can flip it.
  useEffect(() => {
    let anchorY = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      const delta = y - anchorY
      if (Math.abs(delta) < 56) return
      // Never hidden near the top, where there is nothing to scroll away from.
      setNavHidden(delta > 0 && y > 120)
      anchorY = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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
          <Image
            className={styles.mark}
            src="/logo.png"
            alt=""
            width={64}
            height={64}
            priority
          />
          <span className={styles.brandName}>Solio</span>
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

        <div className={styles.search}>
          <SearchBar />
        </div>

        <div className={styles.actions}>
          {/* Desktop only. On a phone it moves into the menu — see the
              stylesheet — so the bar can give the width to the search field. */}
          <ThemeToggle className={styles.themeButton} />

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
                <Avatar name={user.displayName} src={user.avatarUrl} size={28} />
                <ChevronDownIcon size={14} className={styles.chevron} />
              </button>

              {menuOpen && <Menu user={user} onNavigate={() => setMenuOpen(false)} />}
            </div>
          ) : (
            <Link href={loginHref} className={styles.login}>
              Нэвтрэх
            </Link>
          )}
        </div>
      </div>

      {/* Second row on a phone, where the top row has no space for links. It
          steps out of the way while the reader is scrolling down a list and
          comes back the moment they scroll up. */}
      <nav className={styles.navMobile} data-hidden={navHidden} aria-label="Үндсэн цэс">
        <div className="container">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.mobileLink}
              data-active={isActive(item.href)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  )
}

function Menu({
  user,
  onNavigate,
}: {
  user: NonNullable<HeaderUser>
  onNavigate: () => void
}) {
  return (
    <div className={styles.menu} role="menu">
      <div className={styles.menuHead}>
        <p className={styles.menuName}>{user.displayName}</p>
        <p className={styles.menuUser}>@{user.username}</p>
      </div>

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

      <div className={styles.menuDivider} role="separator">
        <ThemeMenuItem className={`${styles.menuItem} ${styles.themeItem}`} />
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

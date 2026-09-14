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
  HomeIcon,
  HeartIcon,
  BellIcon,
  BookIcon,
  ChevronDownIcon,
  LogOutIcon,
  PanelIcon,
  PinIcon,
  SettingsIcon,
  SwapIcon,
  UserIcon,
} from './Icons'
import styles from './Header.module.css'

/**
 * "Номнууд" is deliberately absent: /search still exists and the header's search
 * box still reaches it, but as a nav destination it was the home page again with
 * a different heading, and it cost the bottom bar a slot that notifications
 * needed more.
 */
const NAV = [
  { href: '/', label: 'Нүүр', Icon: HomeIcon },
  { href: '/requests', label: 'Сураглах', Icon: HeartIcon },
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

  // Come back to whatever they were reading. Auth pages are skipped so that
  // bouncing between login and register does not make one the other's target.
  const loginHref =
    pathname.startsWith('/login') || pathname.startsWith('/register')
      ? '/login'
      : `/login?next=${encodeURIComponent(pathname)}`

  const navItems = [
    ...NAV,
    ...(isStaff ? ([{ href: '/admin', label: 'Админ', Icon: SettingsIcon }] as const) : []),
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
          <Image
            className={styles.mark}
            src="/header-logo.png"
            alt=""
            width={64}
            height={64}
            priority
          />
          <span className={styles.brandName}>Solio</span>
        </Link>

        {/* Desktop only. On a phone the same links sit in a bar at the bottom
            of the screen — see MobileNav — where a thumb reaches them without
            crossing the page. */}
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
              data-unread={unreadCount > 0}
              aria-label={unreadCount > 0 ? `Мэдэгдэл (${unreadCount} шинэ)` : 'Мэдэгдэл'}
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

    </header>
  )
}

/**
 * The phone's main navigation, pinned to the bottom of the screen where a thumb
 * reaches. It steps out of the way while the reader is scrolling down a list
 * and comes back the moment they scroll up.
 *
 * Rendered beside the header rather than inside it: it is fixed to the viewport
 * now, and leaving it in the header would keep reserving space at the top.
 */
export function MobileNav({
  isStaff = false,
  signedIn = false,
  unreadCount = 0,
}: {
  isStaff?: boolean
  signedIn?: boolean
  unreadCount?: number
}) {
  const pathname = usePathname()
  const [hidden, setHidden] = useState(false)

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  // Notifications live down here on a phone rather than in the top bar: it is
  // the one thing people open repeatedly, and a thumb reaches the bottom of the
  // screen without crossing the page.
  const items = [
    ...NAV,
    ...(signedIn
      ? ([{ href: '/notifications', label: 'Мэдэгдэл', Icon: BellIcon }] as const)
      : []),
    ...(isStaff ? ([{ href: '/admin', label: 'Админ', Icon: PanelIcon }] as const) : []),
  ]

  // Measured against the position of the last toggle, not the last event: the
  // bar's own appearance nudges the scroll position, and comparing with the
  // previous event reads that nudge as a scroll in the opposite direction.
  useEffect(() => {
    let anchorY = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      const delta = y - anchorY
      if (Math.abs(delta) < 56) return
      setHidden(delta > 0 && y > 120)
      anchorY = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={styles.bottomNav} data-hidden={hidden} aria-label="Үндсэн цэс">
      {items.map(({ href, label, Icon }) => {
        const unread = href === '/notifications' && unreadCount > 0
        return (
          <Link
            key={href}
            href={href}
            className={styles.bottomLink}
            data-active={isActive(href)}
            data-unread={unread}
          >
            <span className={styles.bottomIcon}>
              <Icon size={21} />
              {unread && (
                <span className={styles.bottomBadge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </span>
            <span className={styles.bottomLabel}>{label}</span>
          </Link>
        )
      })}
    </nav>
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
        Миний цуглуулга
      </Link>
      <Link href="/swaps" className={styles.menuItem} onClick={onNavigate}>
        <SwapIcon size={17} />
        Солилцоо
      </Link>
      <Link href="/storage-points" className={styles.menuItem} onClick={onNavigate}>
        <PinIcon size={17} />
        Хадгалах цэгүүд
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

'use client'

import Link from 'next/link'
import { Avatar } from './Avatar'
import type { ReactNode } from 'react'
import { useState } from 'react'
import {
  BookIcon,
  ChevronDownIcon,
  HeartIcon,
  PanelIcon,
  SwapIcon,
  UserIcon,
} from './Icons'
import styles from './UserDashboard.module.css'

export type PanelKey = 'books' | 'wishlist' | 'swaps'

export type UserInfo = {
  name: string
  username: string
  city?: string | null
  email?: string | null
  avatarUrl?: string | null
}

const PANELS: { key: PanelKey; label: string; Icon: typeof BookIcon }[] = [
  { key: 'books', label: 'Миний номнууд', Icon: BookIcon },
  { key: 'wishlist', label: 'Ном хүсэх', Icon: HeartIcon },
  { key: 'swaps', label: 'Солилцоо', Icon: SwapIcon },
]

// Only the rows worth showing as text; the picture is rendered above.
const DETAILS: { key: 'email' | 'city'; label: string }[] = [
  { key: 'email', label: 'И-мэйл' },
  { key: 'city', label: 'Хот / Байршил' },
]

export function UserDashboard({
  initialPanel,
  panels,
  userInfo,
}: {
  initialPanel: PanelKey
  panels: Record<PanelKey, ReactNode>
  userInfo: UserInfo
}) {
  const [active, setActive] = useState<PanelKey>(initialPanel)
  const [collapsed, setCollapsed] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  return (
    <div className={styles.wrap} data-collapsed={collapsed}>
      <aside className={styles.sidebar}>
        <div className={styles.identity} data-label>
          <Avatar name={userInfo.name} src={userInfo.avatarUrl} size={34} />
          <span className={styles.identityName}>{userInfo.name}</span>
        </div>

        <button
          type="button"
          className={styles.subMenu}
          data-open={infoOpen}
          data-label
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen((v) => !v)}
        >
          <UserIcon size={18} />
          <span className={styles.subMenuLabel}>Миний мэдээлэл</span>
          <ChevronDownIcon size={15} className={styles.subMenuChevron} />
        </button>

        <div className={styles.subMenuBody} data-open={infoOpen}>
          <div className={styles.subMenuInner}>
            <dl className={styles.details}>
              {DETAILS.map(({ key, label }) => {
                const value = userInfo[key]
                return (
                  value != null && (
                    <div key={key} className={styles.detailRow}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  )
                )
              })}
              {DETAILS.every(({ key }) => userInfo[key] == null) && (
                <p className={styles.noDetails}>Нэмэлт мэдээлэл байхгүй.</p>
              )}
            </dl>
            <div className={styles.detailLinks}>
              <Link href="/settings" className={styles.detailLink}>
                Профайл засах
              </Link>
            </div>
          </div>
        </div>

        <div className={styles.divider} />

        <div className={styles.sidebarHead}>
          <span className={styles.sidebarTitle} data-label>Цэс</span>
          <button
            type="button"
            className={styles.collapse}
            aria-label={collapsed ? 'Цэс нээх' : 'Цэс нуух'}
            onClick={() => setCollapsed((v) => !v)}
          >
            <PanelIcon size={18} />
          </button>
        </div>

        <nav className={styles.nav} aria-label="Хувийн цэс">
          {PANELS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={styles.navItem}
              data-active={active === key}
              data-label
              aria-current={active === key ? 'page' : undefined}
              title={collapsed ? label : undefined}
              onClick={() => setActive(key)}
            >
              <Icon size={20} />
              <span className={styles.navLabel}>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className={styles.content}>
        {PANELS.map(({ key }) => (
          <div
            key={key}
            className={styles.panel}
            data-active={active === key}
            hidden={active !== key}
          >
            {panels[key]}
          </div>
        ))}
      </div>
    </div>
  )
}
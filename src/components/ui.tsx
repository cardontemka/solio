import Link from 'next/link'
import type { ReactNode } from 'react'
import styles from './ui.module.css'

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className={styles.pageHeader}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
      </div>
      {action && <div className={styles.pageAction}>{action}</div>}
    </div>
  )
}

export function Section({
  title,
  description,
  href,
  children,
}: {
  title: string
  description?: string
  href?: string
  children: ReactNode
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {description && <p className={styles.sectionDesc}>{description}</p>}
        </div>
        {href && (
          <Link href={href} className={styles.sectionLink}>
            Бүгдийг үзэх →
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyMark} aria-hidden="true" />
      <h3 className={styles.emptyTitle}>{title}</h3>
      {description && <p className={styles.emptyDesc}>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  )
}

export function ButtonLink({
  href,
  variant = 'primary',
  children,
}: {
  href: string
  variant?: 'primary' | 'secondary'
  children: ReactNode
}) {
  return (
    <Link href={href} className={styles.button} data-variant={variant}>
      {children}
    </Link>
  )
}

export function Card({ children }: { children: ReactNode }) {
  return <div className={styles.card}>{children}</div>
}

/** Shown where a real mutation will live once Supabase is wired up. */
export function NotWiredNote({ children }: { children: ReactNode }) {
  return <p className={styles.notWired}>⚙︎ {children}</p>
}

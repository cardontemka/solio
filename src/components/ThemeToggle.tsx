'use client'

import { isTheme, THEME_COOKIE, THEME_STORAGE, type Theme } from './theme'
import styles from './ThemeToggle.module.css'

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  return isTheme(attr) ? attr : 'light'
}

function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    window.localStorage.setItem(THEME_STORAGE, theme)
    document.cookie = `${THEME_COOKIE}=${theme};path=/;max-age=31536000;samesite=lax`
  } catch {}
}

/**
 * Manual light/dark toggle. Both icons render and CSS switches which is shown
 * based on the <html data-theme> attribute, so there is nothing to hydrate —
 * avoiding server/client mismatches.
 */
export function ThemeToggle() {
  const onClick = () => apply(currentTheme() === 'dark' ? 'light' : 'dark')

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={onClick}
      aria-label="Гэрэл / Харанхуй горим солих"
      title="Гэрэл / Харанхуй горим"
    >
      <SunIcon className={styles.sun} />
      <MoonIcon className={styles.moon} />
    </button>
  )
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
    </svg>
  )
}
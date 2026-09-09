'use client'

import { isTheme, THEME_COOKIE, THEME_STORAGE, type Theme } from './theme'
import styles from './ThemeToggle.module.css'

/**
 * What the reader is looking at right now — which is not the same as what they
 * have chosen. With no stored choice there is no data-theme attribute at all and
 * the page follows the system, so reading the attribute alone reported "light"
 * to somebody sitting in front of a dark screen. Their first click then set
 * `dark`, which is what it already was, and nothing happened; only the second
 * click did anything.
 */
function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  if (isTheme(attr)) return attr
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** How long the page spends crossing between palettes. Mirrors globals.css. */
const CROSSFADE_MS = 300

const timers: ReturnType<typeof setTimeout>[] = []
function later(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, ms))
}

/**
 * Swaps the palette, and lets the page cross rather than cut.
 *
 * The colours all come from custom properties, and a custom property cannot be
 * transitioned into a repaint of everything that reads it. So the switch marks
 * the document for a moment and globals.css gives every element a short colour
 * transition while the mark is there — the standard way round it, and the reason
 * it is temporary: leaving that transition on permanently would put a lag on
 * every hover on the site.
 */
function apply(theme: Theme) {
  const root = document.documentElement
  const was = currentTheme()
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  timers.splice(0).forEach(clearTimeout)

  if (!still) {
    root.setAttribute('data-theme-switching', '')

    // color-scheme is what the browser paints the scrollbar, the form controls
    // and the canvas beyond the page with, and it cannot be transitioned — it
    // flips in one frame. Left alone it flipped at the *start*, so for the whole
    // fade a dark scrollbar sat beside a page that was still light. Holding the
    // old value and releasing it halfway puts the one unavoidable jump where the
    // page is halfway too, which is where it is least visible.
    root.style.colorScheme = was
    later(CROSSFADE_MS / 2, () => {
      root.style.colorScheme = ''
    })

    // Comfortably past the longest transition. Removing the rule at exactly
    // CROSSFADE_MS was a race with the transitions it starts: whenever the timer
    // won, every colour still in flight snapped to its end value.
    later(CROSSFADE_MS + 140, () => root.removeAttribute('data-theme-switching'))
  }

  root.setAttribute('data-theme', theme)
  try {
    window.localStorage.setItem(THEME_STORAGE, theme)
    document.cookie = `${THEME_COOKIE}=${theme};path=/;max-age=31536000;samesite=lax`
  } catch {}
}

/**
 * Manual light/dark toggle. Both icons — and, in the menu form, both labels —
 * render, and CSS picks which is shown from the <html data-theme> attribute.
 * Nothing depends on client state, so there is nothing to hydrate and no
 * server/client mismatch.
 */
/**
 * `className` is composed with the base class, never substituted for it: the
 * caller passes one only to hide the button on a phone, and replacing the class
 * outright stripped every style the control had.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const onClick = () => apply(currentTheme() === 'dark' ? 'light' : 'dark')

  return (
    <button
      type="button"
      className={className ? `${styles.toggle} ${className}` : styles.toggle}
      onClick={onClick}
      aria-label="Гэрэл / Харанхуй горим солих"
      title="Гэрэл / Харанхуй горим"
    >
      <SunIcon className={styles.sun} />
      <MoonIcon className={styles.moon} />
    </button>
  )
}

/** The same control as a row inside the user menu. */
export function ThemeMenuItem({ className }: { className?: string }) {
  const onClick = () => apply(currentTheme() === 'dark' ? 'light' : 'dark')

  return (
    <button type="button" className={className} onClick={onClick}>
      <span className={styles.menuIcons} aria-hidden="true">
        <SunIcon className={styles.sun} size={17} />
        <MoonIcon className={styles.moon} size={17} />
      </span>
      <span className={styles.sun}>Харанхуй горим</span>
      <span className={styles.moon}>Гэрэл горим</span>
    </button>
  )
}

function SunIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
    </svg>
  )
}
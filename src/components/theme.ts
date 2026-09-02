export const THEME_COOKIE = 'solio-theme'
export const THEME_STORAGE = 'solio-theme'

export const THEME_VALUES = ['light', 'dark'] as const
export type Theme = (typeof THEME_VALUES)[number]

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}
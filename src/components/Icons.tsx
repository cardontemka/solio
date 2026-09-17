'use client'

import type { ComponentProps } from 'react'
import {
  ArrowsLeftRight,
  Bell,
  BookOpen,
  CaretDown,
  CaretLeft,
  Clock,
  Coin,
  Eye,
  EyeSlash,
  Flag,
  Gear,
  Heart,
  House,
  Lock,
  MagnifyingGlass,
  MapPin,
  Plus,
  QrCode,
  SidebarSimple,
  SignOut,
  User,
} from '@phosphor-icons/react'

/**
 * Every icon on the site, drawn by Phosphor.
 *
 * These were hand-written SVGs — twenty of them, each a few paths, each drifting
 * a little from the others in weight and corner radius as they were added one at
 * a time. A published set is consistent by construction, has a shape for the
 * thing you need next, and is somebody else's job to maintain.
 *
 * The names and the props are unchanged, deliberately: every call site still
 * writes `<BellIcon size={20} />`, so swapping the set touched this file and
 * nothing else. `size` is Phosphor's own prop; `weight` is fixed at regular so
 * that one import cannot quietly look heavier than its neighbour.
 */
type PhosphorProps = ComponentProps<typeof House>
export type IconProps = Omit<PhosphorProps, 'weight'> & { size?: number }

function wrap(Glyph: typeof House) {
  return function Icon({ size = 20, ...props }: IconProps) {
    return <Glyph size={size} weight="regular" aria-hidden {...props} />
  }
}

export const HomeIcon = wrap(House)
export const SearchIcon = wrap(MagnifyingGlass)
export const BookIcon = wrap(BookOpen)
export const HeartIcon = wrap(Heart)
export const SwapIcon = wrap(ArrowsLeftRight)
export const BellIcon = wrap(Bell)
export const UserIcon = wrap(User)
export const PlusIcon = wrap(Plus)
export const FlagIcon = wrap(Flag)
export const ChevronDownIcon = wrap(CaretDown)
export const ChevronLeftIcon = wrap(CaretLeft)
export const PanelIcon = wrap(SidebarSimple)
export const LogOutIcon = wrap(SignOut)
export const SettingsIcon = wrap(Gear)
export const EyeIcon = wrap(Eye)
export const EyeOffIcon = wrap(EyeSlash)
export const LockIcon = wrap(Lock)
/** A storage point is, above all, a place. */
export const PinIcon = wrap(MapPin)
/** Opening hours — the other half of "can I get there?". */
export const ClockIcon = wrap(Clock)
/** What one donated book is worth, and what one taken book costs. */
export const CoinIcon = wrap(Coin)
/** The code printed on every item. */
export const ScanIcon = wrap(QrCode)

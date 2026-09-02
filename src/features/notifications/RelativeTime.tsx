'use client'

import { useEffect, useState } from 'react'

function format(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'дөнгөж сая'
  if (min < 60) return `${min} минутын өмнө`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} цагийн өмнө`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'өчигдөр'
  if (days < 30) return `${days} өдрийн өмнө`
  return iso.slice(0, 10)
}

/**
 * "Now" is not available during render — it would make render impure and the
 * server/client values would disagree. Render the absolute date first, then
 * switch to relative once mounted.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const [label, setLabel] = useState(() => iso.slice(0, 10))

  useEffect(() => {
    const update = () => setLabel(format(iso, Date.now()))
    update()
    const timer = setInterval(update, 60_000)
    return () => clearInterval(timer)
  }, [iso])

  return <time dateTime={iso}>{label}</time>
}

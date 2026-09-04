'use client'

import { useEffect, useState } from 'react'
import type { AuthState } from './actions'

/**
 * Turns a rate-limit refusal into a visible countdown.
 *
 * "Хэдэн минутын дараа" tells the reader to guess and keep clicking. The wait
 * is known — GoTrue states it — so it is shown ticking down while the submit
 * button stays disabled.
 *
 * The reset is a render-time state adjustment rather than an effect: useActionState
 * hands back a new object on every submission, and reacting to that in an effect
 * would commit once with a stale count and again with the real one. The clock
 * itself is only ever read inside the timer, never during render.
 */
export function useRetryCooldown(state: AuthState): number {
  const [seen, setSeen] = useState(state)
  const [secondsLeft, setSecondsLeft] = useState(0)

  if (seen !== state) {
    setSeen(state)
    setSecondsLeft(!state.ok && state.retryAfter ? state.retryAfter : 0)
  }

  useEffect(() => {
    if (secondsLeft <= 0) return
    const deadline = Date.now() + secondsLeft * 1000
    // A quarter-second tick so the number never appears to stall on a slow
    // frame, while the value itself stays whole seconds.
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left === 0) clearInterval(timer)
    }, 250)
    return () => clearInterval(timer)
    // Restarts only when a new refusal arrives — not on every tick, which would
    // reset the deadline a hundred times and never reach zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen])

  return secondsLeft
}

/** "1:05" past a minute, "45 секунд" below it. */
export function formatCooldown(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }
  return `${seconds} секунд`
}

'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Tells the page when something has happened, without it being reloaded.
 *
 * One websocket per open tab, opened only for a signed-in reader, carrying only
 * that reader's own notification rows — the filter is applied by the server, and
 * RLS is applied on top of it, so nothing else is ever sent down the wire.
 *
 * On an event it asks the router to refresh. That re-runs the server components
 * — the bell's count, the notification list, whatever panel is on screen — and
 * swaps in the new HTML without touching the reader's scroll position or any
 * form they are halfway through. It is throttled, because a completed swap
 * writes several rows at once and one refresh answers all of them.
 *
 * Renders nothing.
 */
export function LiveNotifications({ userId }: { userId: string }) {
  const router = useRouter()
  const lastRefresh = useRef(0)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    /** At most one refresh every three seconds, and never more than one queued. */
    const refresh = () => {
      const since = Date.now() - lastRefresh.current
      if (since >= 3000) {
        lastRefresh.current = Date.now()
        router.refresh()
        return
      }
      if (timer.current !== null) return
      timer.current = window.setTimeout(() => {
        timer.current = null
        lastRefresh.current = Date.now()
        router.refresh()
      }, 3000 - since)
    }

    /**
     * Realtime opens its socket with the publishable key alone, and these rows
     * are behind RLS that only ever matches their owner — so with the anon
     * token the subscription is live, correct and permanently silent. The
     * access token has to be handed over explicitly, and re-handed whenever it
     * is rotated, or the socket goes quiet an hour after sign-in.
     */
    const subscribe = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled || !session) return
      supabase.realtime.setAuth(session.access_token)

      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          refresh
        )
        // A read elsewhere — another tab, the notifications page — should take
        // the badge down here too.
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          refresh
        )
        .subscribe()
    }

    subscribe()

    // The token is replaced roughly hourly; without this the socket keeps its
    // old one and quietly stops matching rows.
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token)
    })

    return () => {
      cancelled = true
      auth.subscription.unsubscribe()
      if (timer.current !== null) clearTimeout(timer.current)
      if (channel) supabase.removeChannel(channel)
    }
  }, [router, userId])

  return null
}

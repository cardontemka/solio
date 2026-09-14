'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import styles from '@/components/forms.module.css'

/**
 * What the auth server said, when it said it in the URL fragment.
 *
 * GoTrue reports a dead or refused link as `#error=access_denied&
 * error_code=otp_expired&error_description=…`. A fragment is never sent to a
 * server, so the route handler this arrives through cannot see any of it and
 * used to report a missing code — telling somebody whose link had expired that
 * their link was truncated.
 *
 * Read here instead, where the fragment still exists, and then wiped from the
 * address bar so a reload does not replay a message about a link that is
 * already gone.
 */
const BY_CODE: Record<string, string> = {
  otp_expired:
    'Баталгаажуулах холбоосын хугацаа дууссан байна. Шинээр илгээж, ирсэн холбоос дээр шууд дарна уу.',
  access_denied: 'Нэвтрэх хүсэлт цуцлагдсан байна. Дахин оролдоно уу.',
  provider_email_needs_verification:
    'Google хаягийн email хаяг баталгаажаагүй байна. Эхлээд түүнийг баталгаажуулна уу.',
  validation_failed: 'Нэвтрэх хүсэлт бүрэн бус байна. Дахин эхнээс нь оролдоно уу.',
  flow_state_not_found:
    'Энэ холбоос аль хэдийн ашиглагдсан байна. Нэвтрэх товчоо дахин дарна уу.',
}

function messageFrom(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const code = params.get('error_code')
  const description = params.get('error_description')
  if (!params.get('error') && !code && !description) return null
  return (
    (code && BY_CODE[code]) ||
    (description ? description.replace(/\+/g, ' ') : null) ||
    'Нэвтрэх холбоос ажиллахгүй байна. Дахин оролдоно уу.'
  )
}

export function AuthHashNotice() {
  // The fragment exists only in the browser, so it is read as an external
  // store: useSyncExternalStore renders the server's empty snapshot during
  // hydration and swaps in the real one afterwards, which is the one way to
  // read `location` in a client component without a hydration mismatch.
  //
  // Latched on first read, because the effect below wipes the fragment — the
  // snapshot has to keep returning the same string or the message would vanish
  // from under the reader on the next render.
  const latched = useRef<string | null>(null)
  const hash = useSyncExternalStore(
    () => () => {},
    () => (latched.current ??= window.location.hash),
    () => ''
  )
  const message = messageFrom(hash)

  useEffect(() => {
    if (!message) return
    // Same entry, minus the fragment: replaceState so Back does not walk into
    // a URL that carries a spent token.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [message])

  if (!message) return null
  return (
    <p className={styles.formMessage} role="alert">
      {message}
    </p>
  )
}

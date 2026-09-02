'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from '@/components/forms.module.css'

/**
 * OAuth has to start in the browser: Supabase redirects the window to Google,
 * which redirects back to /api/auth/callback with a code. This is the one
 * place the browser Supabase client is used — everything else is a Server
 * Action.
 */
export function GoogleButton({ next = '/my-books' }: { next?: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        className={styles.oauthActive}
        disabled={pending}
        onClick={async () => {
          setPending(true)
          setError(null)
          const supabase = createClient()
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
            },
          })
          if (error) {
            console.error('[GoogleButton]', error.message)
            setError('Google-ээр нэвтэрч чадсангүй. Дараа дахин оролдоно уу.')
            setPending(false)
          }
          // On success the browser navigates away; no state reset needed.
        }}
      >
        <svg viewBox="0 0 18 18" className={styles.oauthIcon} aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"/>
          <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"/>
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/>
        </svg>
        {pending ? 'Google руу шилжиж байна…' : 'Google-ээр үргэлжлүүлэх'}
      </button>
      {error && <p className={styles.formMessage}>{error}</p>}
    </>
  )
}

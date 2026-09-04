'use client'

import { useEffect, useState } from 'react'
import { removePushSubscriptionAction, savePushSubscriptionAction } from './pushActions'
import styles from './PushToggle.module.css'

/**
 * Turns browser notifications on for this device.
 *
 * Permission is asked only when the reader presses the button. A prompt on page
 * load is the thing everyone blocks, and a blocked permission cannot be asked
 * for again — so the one chance is spent on a deliberate click.
 */
// PushManager wants the VAPID key as raw bytes; it travels as base64url.
// Typed as ArrayBuffer rather than Uint8Array because the DOM signature rejects
// a view that might be backed by a SharedArrayBuffer.
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes.buffer
}

type State = 'checking' | 'unsupported' | 'denied' | 'off' | 'on'

export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>('checking')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const settle = (next: State) => {
      if (!cancelled) setState(next)
    }

    // Every branch resolves asynchronously: setting state straight from the
    // effect body commits twice for one render, which is what React's lint
    // rule is pointing at.
    Promise.resolve()
      .then(async () => {
        if (!publicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) {
          return settle('unsupported')
        }
        if (Notification.permission === 'denied') return settle('denied')
        const registration = await navigator.serviceWorker.getRegistration()
        const subscription = await registration?.pushManager.getSubscription()
        settle(subscription ? 'on' : 'off')
      })
      .catch(() => settle('off'))

    return () => {
      cancelled = true
    }
  }, [publicKey])

  async function enable() {
    if (!publicKey) return
    setBusy(true)
    setError(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      })
      const json = sub.toJSON()
      const saved = await savePushSubscriptionAction({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        userAgent: navigator.userAgent.slice(0, 400),
      })
      if (!saved.ok) {
        await sub.unsubscribe()
        setError(saved.message)
        setState('off')
        return
      }
      setState('on')
    } catch (e) {
      console.error('[push] enable failed', e)
      setError('Мэдэгдлийг идэвхжүүлж чадсангүй.')
      setState('off')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint)
        await sub.unsubscribe()
      }
      setState('off')
    } catch {
      setError('Унтраахад алдаа гарлаа.')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'checking') return null

  return (
    <div className={styles.wrap}>
      <div className={styles.copy}>
        <p className={styles.title}>Хөтчийн мэдэгдэл</p>
        <p className={styles.hint}>
          {state === 'unsupported'
            ? 'Энэ хөтөч дээр боломжгүй байна.'
            : state === 'denied'
              ? 'Хөтөч дээр хориглосон байна. Хаягийн мөрний түгжээ дүрснээс зөвшөөрнө үү.'
              : state === 'on'
                ? 'Энэ төхөөрөмж дээр асаалттай. Солилцоо, сэтгэгдэл дээр мэдэгдэнэ.'
                : 'Сайт хаалттай үед ч солилцоо, сэтгэгдлийн мэдэгдэл хүлээж авна.'}
        </p>
      </div>

      {state === 'on' && (
        <button type="button" className={styles.off} disabled={busy} onClick={disable}>
          {busy ? '…' : 'Унтраах'}
        </button>
      )}
      {state === 'off' && (
        <button type="button" className={styles.on} disabled={busy} onClick={enable}>
          {busy ? 'Асааж байна…' : 'Асаах'}
        </button>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

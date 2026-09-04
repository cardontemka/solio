import 'server-only'

/**
 * Web push identifies the sender with a VAPID key pair. The public half is
 * handed to the browser at subscribe time; the private half signs every send
 * and must never leave the server — hence no NEXT_PUBLIC_ prefix on it.
 *
 * Generate a pair with `npx web-push generate-vapid-keys` (docs/setup.md).
 * With none configured, push is simply off: the in-app notification list keeps
 * working and nothing in the app breaks.
 */
export type VapidConfig = { publicKey: string; privateKey: string; subject: string }

export function vapidConfig(): VapidConfig | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return null
  return {
    publicKey,
    privateKey,
    // Push services require a contact for the sender; mailto is the norm.
    subject: process.env.VAPID_SUBJECT || 'mailto:hello@solio.mn',
  }
}

export function isPushConfigured(): boolean {
  return vapidConfig() !== null
}

'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/validation/env'
import { bookImageStorage } from '@/lib/storage'
import { sniffMime } from '@/lib/storage/verify'

export type AuthState =
  | {
      ok: false
      message?: string
      errors?: Record<string, string[]>
      /** Echoed back so a rejected form keeps what was typed. Never a password. */
      values?: { displayName?: string; username?: string; email?: string }
      /** Seconds to wait before retrying, when the refusal was a rate limit. */
      retryAfter?: number
    }
  | { ok: true; pendingConfirmation?: boolean }

/**
 * Every message below names the rule that was broken, not the fact that
 * something was. A form that only says "буруу" makes the reader guess, and the
 * guess is usually retyping everything.
 */
const EMAIL_MESSAGE = 'Email хаяг "нэр@домэйн.mn" хэлбэртэй байх ёстой.'

/**
 * How long to wait, when GoTrue says.
 *
 * The per-address delay states it in prose — "you can only request this after
 * 51 seconds" — and there is no structured retry-after to read instead: the 429
 * carries no Retry-After header (verified against the live project), so the
 * number has to come out of the message.
 *
 * The project-wide email quota says only "email rate limit exceeded". Returning
 * a guessed minute there would be worse than saying nothing — that limit is
 * hourly — so this returns null and the caller explains instead of counting.
 */
function retryAfterFrom(message: string): number | null {
  const seconds = message.match(/after\s+(\d+)\s*second/i)
  if (seconds) return Math.min(Number(seconds[1]) + 1, 3600)
  const minutes = message.match(/after\s+(\d+)\s*minute/i)
  if (minutes) return Math.min(Number(minutes[1]) * 60, 3600)
  return null
}

const PASSWORD_RULE = z
  .string()
  .min(8, 'Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой.')
  .max(72, 'Нууц үг 72 тэмдэгтээс их байж болохгүй.')

const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Харагдах нэрээ бичнэ үү.')
    .max(60, 'Харагдах нэр 60 тэмдэгтээс их байж болохгүй.'),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Хэрэглэгчийн нэр хамгийн багадаа 3 тэмдэгт байна.')
    .max(24, 'Хэрэглэгчийн нэр 24 тэмдэгтээс их байж болохгүй.')
    .regex(
      /^[a-z0-9_]+$/,
      'Хэрэглэгчийн нэрд зөвхөн жижиг латин үсэг, тоо, доогуур зураас (_) байж болно. Зай, том үсэг, кирилл болохгүй.'
    ),
  email: z.string().trim().min(1, 'Email хаягаа бичнэ үү.').email(EMAIL_MESSAGE),
  password: PASSWORD_RULE,
  passwordConfirm: z.string().min(1, 'Нууц үгээ дахин бичнэ үү.'),
})
  // Reported against the second box, so the error appears under the one the
  // reader should retype rather than the one they most likely got right.
  .refine((v) => v.password === v.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'Хоёр нууц үг таарахгүй байна.',
  })

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email хаягаа бичнэ үү.').email(EMAIL_MESSAGE),
  password: z.string().min(1, 'Нууц үгээ бичнэ үү.'),
})

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    username: formData.get('username') ?? '',
    email: formData.get('email') ?? '',
    password: formData.get('password') ?? '',
    passwordConfirm: formData.get('passwordConfirm') ?? '',
  })
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      values: {
        displayName: String(formData.get('displayName') ?? ''),
        username: String(formData.get('username') ?? ''),
        email: String(formData.get('email') ?? ''),
      },
    }
  }

  const supabase = await createClient()

  // Usernames are public (/u/<username>), so checking one here reveals nothing
  // that the profile pages do not. Without this the signup trigger silently
  // appends a digit and the person ends up with a name they never chose.
  const { data: taken } = await supabase
    .from('profiles')
    .select('username')
    .ilike('username', parsed.data.username)
    .maybeSingle()
  if (taken) {
    return {
      ok: false,
      errors: { username: ['Энэ хэрэглэгчийн нэр эзэмшигдсэн байна. Өөрийг сонгоно уу.'] },
      values: { displayName: parsed.data.displayName, username: '', email: parsed.data.email },
    }
  }

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Read by the on_auth_user_created trigger to seed the profile row.
      data: { username: parsed.data.username, display_name: parsed.data.displayName },
      emailRedirectTo: `${publicEnv.siteUrl.replace(/\/+$/, '')}/api/auth/callback`,
    },
  })

  const keep = {
    displayName: parsed.data.displayName,
    username: parsed.data.username,
    email: parsed.data.email,
  }

  if (error) {
    console.error('[registerAction]', error.code, error.message)
    switch (error.code) {
      case 'weak_password':
        return {
          ok: false,
          errors: {
            password: [
              'Нууц үг хэтэрхий хялбар байна. Урт болгож, тоо болон том үсэг нэмнэ үү.',
            ],
          },
          values: keep,
        }
      case 'email_address_invalid':
        // Shape was already checked by the schema, so reaching here means the
        // server refused the address itself — usually a domain it does not
        // accept. Repeating the format rule would send the reader hunting for
        // a typo that is not there.
        return {
          ok: false,
          errors: {
            email: ['Энэ email хаягийг систем хүлээж авахгүй байна. Өөр хаяг ашиглана уу.'],
          },
          values: keep,
        }
      case 'user_already_exists':
      case 'email_exists':
        return {
          ok: false,
          errors: {
            email: ['Энэ email хаягаар бүртгэл аль хэдийн байна. Нэвтрэх хуудсаар орно уу.'],
          },
          values: keep,
        }
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit': {
        const wait = retryAfterFrom(error.message)
        if (wait) {
          return { ok: false, message: 'Хэт олон удаа оролдлоо.', retryAfter: wait, values: keep }
        }
        return {
          ok: false,
          message:
            'Баталгаажуулах имэйл илгээх цагийн хязгаарт хүрлээ. Нэг цагийн дараа дахин ' +
            'оролдоно уу, эсвэл имэйл шаарддаггүй Google-ээр үргэлжлүүлж болно.',
          values: keep,
        }
      }
      default:
        return {
          ok: false,
          message: `Бүртгэл үүсгэж чадсангүй (${error.code ?? error.status ?? 'тодорхойгүй'}). Дахин оролдоно уу.`,
          values: keep,
        }
    }
  }

  // With confirmations enabled, signing up an address that already has a
  // confirmed account returns a user with no identities rather than an error.
  // Left unhandled, the reader is told to check an inbox nothing was sent to.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return {
      ok: false,
      errors: {
        email: ['Энэ email хаягаар бүртгэл аль хэдийн байна. Нэвтрэх хуудсаар орно уу.'],
      },
      values: keep,
    }
  }

  // Kept for the case where email confirmation is switched back on: there is
  // no session yet, and redirecting would bounce straight back to /login and
  // read as a failure.
  if (!data.session) {
    return { ok: true, pendingConfirmation: true }
  }

  revalidatePath('/', 'layout')
  // Same rule as login: a relative path only, so a crafted `next` cannot bounce
  // a freshly signed-in reader off to another site.
  const next = formData.get('next')
  redirect(
    typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')
      ? next
      : '/dashboard'
  )
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email') ?? '',
    password: formData.get('password') ?? '',
  })
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      values: { email: String(formData.get('email') ?? '') },
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    console.error('[loginAction]', error.code, error.message)
    const keep = { email: parsed.data.email }
    switch (error.code) {
      case 'email_not_confirmed':
        return {
          ok: false,
          message:
            'Email хаягаа баталгаажуулаагүй байна. Бүртгэхэд илгээсэн имэйл дэх линкийг дарна уу.',
          values: keep,
        }
      case 'over_request_rate_limit': {
        const wait = retryAfterFrom(error.message)
        return {
          ok: false,
          message: wait
            ? 'Хэт олон удаа оролдлоо.'
            : 'Хэт олон удаа оролдлоо. Хэсэг хүлээгээд дахин оролдоно уу.',
          retryAfter: wait ?? undefined,
          values: keep,
        }
      }
      case 'invalid_credentials':
        // Which of the two is wrong is deliberately not said: that would let
        // anyone test whether an address has an account here.
        return { ok: false, message: 'Email хаяг эсвэл нууц үг таарахгүй байна.', values: keep }
      default:
        return {
          ok: false,
          message: `Нэвтэрч чадсангүй (${error.code ?? error.status ?? 'тодорхойгүй'}). Дахин оролдоно уу.`,
          values: keep,
        }
    }
  }

  revalidatePath('/', 'layout')
  const next = formData.get('next')
  redirect(
    typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')
      ? next
      : '/dashboard'
  )
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}

// ── Profile editing ────────────────────────────────────────────────────────

export type ProfileState =
  | { ok: true; username: string }
  | { ok: false; message?: string; errors?: Record<string, string[]> }

const profileSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,24}$/, 'Зөвхөн жижиг үсэг, тоо, доогуур зураас (3–24 тэмдэгт).'),
  displayName: z.string().trim().min(1, 'Нэрээ оруулна уу.').max(60, 'Нэр хэт урт байна.'),
  bio: z.string().trim().max(500, 'Тайлбар 500 тэмдэгтээс их байж болохгүй.').optional(),
  city: z.string().trim().max(60, 'Хотын нэр хэт урт байна.').optional(),
})

/**
 * The owner edits their own row through RLS — profiles_update_self allows it,
 * and private.profiles_guard still refuses account_status, id and created_at,
 * so this action needs no elevated client.
 *
 * The username is part of a public URL (/u/<username>), which is why it is
 * editable at all: handle_new_user can only guess one from an email address.
 */
export async function updateProfileAction(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = profileSchema.safeParse({
    username: formData.get('username'),
    displayName: formData.get('displayName'),
    bio: formData.get('bio') ?? '',
    city: formData.get('city') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const { username, displayName, bio, city } = parsed.data
  const { error } = await supabase
    .from('profiles')
    .update({
      username,
      display_name: displayName,
      bio: bio || null,
      city: city || null,
    })
    .eq('id', user.id)

  if (error) {
    // profiles_username_key is a unique index on lower(username).
    if (error.code === '23505') {
      return { ok: false, errors: { username: ['Энэ хэрэглэгчийн нэр эзэмшигдсэн байна.'] } }
    }
    return { ok: false, message: 'Профайлыг хадгалж чадсангүй.' }
  }

  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath(`/u/${username}`)
  // Straight to the page the edits are for, so the reader sees the result
  // rather than a form with a tick on it. redirect() throws, so nothing after
  // this runs.
  redirect(`/u/${username}`)
}

// ── Profile picture ────────────────────────────────────────────────────────

export type AvatarState = { ok: true; url: string | null } | { ok: false; message: string }

/**
 * Verifies uploaded avatar bytes and attaches them to the caller's profile.
 *
 * Same rule as book photos: a declared MIME type is not taken on trust. The
 * object's head is read back from storage and sniffed, and anything that is not
 * really an image is deleted rather than linked — otherwise arbitrary bytes
 * would be served from the image host under a user's name.
 *
 * The key is rebuilt from the caller's own id here too, so a forged key cannot
 * point the profile at somebody else's object.
 */
export async function setAvatarAction(storageKey: string): Promise<AvatarState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const expectedPrefix = `avatars/${user.id}/`
  if (!storageKey.startsWith(expectedPrefix) || storageKey.includes('..')) {
    return { ok: false, message: 'Буруу хүсэлт.' }
  }

  const storage = bookImageStorage()
  const head = await storage.readHead(storageKey, 64)
  if (!head || !sniffMime(head)) {
    await storage.delete(storageKey).catch(() => {})
    return { ok: false, message: 'Файл зураг биш байна.' }
  }

  const { data: previous } = await supabase
    .from('profiles')
    .select('avatar_key')
    .eq('id', user.id)
    .single()

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_key: storageKey })
    .eq('id', user.id)
  if (error) {
    await storage.delete(storageKey).catch(() => {})
    return { ok: false, message: 'Зургийг хадгалж чадсангүй.' }
  }

  // The old object is now unreachable; leaving it would grow the bucket for
  // every change of picture.
  if (previous?.avatar_key && previous.avatar_key !== storageKey) {
    await storage.delete(previous.avatar_key).catch(() => {})
  }

  revalidatePath('/', 'layout')
  return { ok: true, url: storage.publicUrl(storageKey) }
}

export async function removeAvatarAction(): Promise<AvatarState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const { data: previous } = await supabase
    .from('profiles')
    .select('avatar_key')
    .eq('id', user.id)
    .single()

  const { error } = await supabase.from('profiles').update({ avatar_key: null }).eq('id', user.id)
  if (error) return { ok: false, message: 'Зургийг устгаж чадсангүй.' }

  if (previous?.avatar_key) {
    await bookImageStorage().delete(previous.avatar_key).catch(() => {})
  }

  revalidatePath('/', 'layout')
  return { ok: true, url: null }
}

// ── Password ───────────────────────────────────────────────────────────────

export type PasswordState =
  | { ok: true }
  | { ok: false; message?: string; errors?: Record<string, string[]>; retryAfter?: number }

const passwordChangeSchema = z
  .object({
    current: z.string(),
    password: PASSWORD_RULE,
    passwordConfirm: z.string().min(1, 'Шинэ нууц үгээ дахин бичнэ үү.'),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'Хоёр нууц үг таарахгүй байна.',
  })

/**
 * Checks a password without touching the caller's session.
 *
 * Signing in on the request's own client would work, but it rotates the auth
 * cookie as a side effect of a *check* — and if the new password is then
 * rejected, the reader has been quietly re-issued a session for no reason. This
 * throwaway client persists nothing, so a wrong guess costs exactly one refused
 * request.
 */
async function passwordMatches(email: string, password: string) {
  const probe = createSupabaseClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await probe.auth.signInWithPassword({ email, password })
  // The session it just minted is not wanted; leaving it alive would pile up
  // refresh tokens on every visit to this form.
  if (data.session) await probe.auth.signOut({ scope: 'local' })
  return { ok: !error, error }
}

/**
 * Changes the signed-in reader's password.
 *
 * The current one is asked for and verified first. Supabase does not require it
 * — a valid session is enough for updateUser — but a session is exactly what an
 * unattended laptop hands to whoever walks past, and a password change locks
 * the owner out. So the old password is the thing that proves it is really them.
 *
 * Someone who signed up with Google has no password at all. For them this sets
 * a first one, and there is nothing to verify.
 */
export async function changePasswordAction(
  _prev: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const hasPassword = (user.identities ?? []).some((i) => i.provider === 'email')

  const parsed = passwordChangeSchema.safeParse({
    current: formData.get('current') ?? '',
    password: formData.get('password') ?? '',
    passwordConfirm: formData.get('passwordConfirm') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  if (hasPassword) {
    if (parsed.data.current.length === 0) {
      return { ok: false, errors: { current: ['Одоогийн нууц үгээ бичнэ үү.'] } }
    }
    if (!user.email) {
      return {
        ok: false,
        message: 'Хаяг дээр email байхгүй тул нууц үгийг шалгаж чадсангүй. Бидэнтэй холбогдоно уу.',
      }
    }
    const check = await passwordMatches(user.email, parsed.data.current)
    if (!check.ok) {
      const code = check.error?.code
      if (code === 'over_request_rate_limit') {
        const wait = retryAfterFrom(check.error?.message ?? '')
        return {
          ok: false,
          message: 'Хэт олон удаа оролдлоо. Хэсэг хүлээгээд дахин оролдоно уу.',
          retryAfter: wait ?? undefined,
        }
      }
      return { ok: false, errors: { current: ['Одоогийн нууц үг таарахгүй байна.'] } }
    }
    if (parsed.data.current === parsed.data.password) {
      return {
        ok: false,
        errors: { password: ['Шинэ нууц үг хуучинтайгаа адилхан байна.'] },
      }
    }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    console.error('[changePasswordAction]', error.code, error.message)
    switch (error.code) {
      case 'weak_password':
        return {
          ok: false,
          errors: {
            password: ['Нууц үг хэтэрхий хялбар байна. Урт болгож, тоо болон том үсэг нэмнэ үү.'],
          },
        }
      case 'same_password':
        return { ok: false, errors: { password: ['Шинэ нууц үг хуучинтайгаа адилхан байна.'] } }
      case 'over_request_rate_limit': {
        const wait = retryAfterFrom(error.message)
        return {
          ok: false,
          message: 'Хэт олон удаа оролдлоо. Хэсэг хүлээгээд дахин оролдоно уу.',
          retryAfter: wait ?? undefined,
        }
      }
      case 'reauthentication_needed':
        return {
          ok: false,
          message: 'Аюулгүй байдлын тохиргоо нэмэлт баталгаажуулалт шаардаж байна. Дахин нэвтэрч оролдоно уу.',
        }
      default:
        return {
          ok: false,
          message: `Нууц үгийг сольж чадсангүй (${error.code ?? error.status ?? 'тодорхойгүй'}).`,
        }
    }
  }

  // A changed password should end the sessions the owner did not change it
  // from: if the reason for changing it was that somebody else had a session,
  // leaving that session alive defeats the whole exercise. This browser keeps
  // its own.
  await supabase.auth.signOut({ scope: 'others' }).catch(() => {})

  return { ok: true }
}

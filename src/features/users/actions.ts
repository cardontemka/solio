'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/validation/env'

export type AuthState =
  | {
      ok: false
      message?: string
      errors?: Record<string, string[]>
      /** Echoed back so a rejected form keeps what was typed. Never a password. */
      values?: { displayName?: string; username?: string; email?: string }
    }
  | { ok: true; pendingConfirmation?: boolean }

/**
 * Every message below names the rule that was broken, not the fact that
 * something was. A form that only says "буруу" makes the reader guess, and the
 * guess is usually retyping everything.
 */
const EMAIL_MESSAGE = 'Email хаяг "нэр@домэйн.mn" хэлбэртэй байх ёстой.'

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
    .min(3, 'Хаяг хамгийн багадаа 3 тэмдэгт байна.')
    .max(24, 'Хаяг 24 тэмдэгтээс их байж болохгүй.')
    .regex(
      /^[a-z0-9_]+$/,
      'Хаягт зөвхөн жижиг латин үсэг, тоо, доогуур зураас (_) байж болно. Зай, том үсэг, кирилл болохгүй.'
    ),
  email: z.string().trim().min(1, 'Email хаягаа бичнэ үү.').email(EMAIL_MESSAGE),
  password: z
    .string()
    .min(8, 'Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой.')
    .max(72, 'Нууц үг 72 тэмдэгтээс их байж болохгүй.'),
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
      errors: { username: ['Энэ хаяг аль хэдийн эзэмшигдсэн. Өөр хаяг сонгоно уу.'] },
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
        return { ok: false, errors: { email: [EMAIL_MESSAGE] }, values: keep }
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
      case 'over_request_rate_limit':
        return {
          ok: false,
          message: 'Хэт олон удаа оролдлоо. Хэдэн минутын дараа дахин оролдоно уу.',
          values: keep,
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

  // With email confirmation enabled there is no session yet. Redirecting would
  // bounce straight back to /login and read as a failure.
  if (!data.session) {
    return { ok: true, pendingConfirmation: true }
  }

  revalidatePath('/', 'layout')
  redirect('/my-books')
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
      case 'over_request_rate_limit':
        return {
          ok: false,
          message: 'Хэт олон удаа оролдлоо. Хэдэн минутын дараа дахин оролдоно уу.',
          values: keep,
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
  redirect(typeof next === 'string' && next.startsWith('/') ? next : '/my-books')
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
      return { ok: false, errors: { username: ['Энэ хаяг аль хэдийн эзэмшигдсэн байна.'] } }
    }
    return { ok: false, message: 'Профайлыг хадгалж чадсангүй.' }
  }

  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath(`/u/${username}`)
  return { ok: true, username }
}

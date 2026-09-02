'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/validation/env'

export type AuthState =
  | { ok: false; message?: string; errors?: Record<string, string[]> }
  | { ok: true; pendingConfirmation?: boolean }

const registerSchema = z.object({
  displayName: z.string().trim().min(1, 'Нэрээ оруулна уу.').max(60),
  username: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{3,24}$/, 'Зөвхөн жижиг үсэг, тоо, доогуур зураас (3–24 тэмдэгт).'),
  email: z.string().trim().email('Зөв email хаяг оруулна уу.'),
  password: z.string().min(8, 'Нууц үг хамгийн багадаа 8 тэмдэгт байна.'),
})

const loginSchema = z.object({
  email: z.string().trim().email('Зөв email хаяг оруулна уу.'),
  password: z.string().min(1, 'Нууц үгээ оруулна уу.'),
})

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    username: formData.get('username') ?? '',
    email: formData.get('email') ?? '',
    password: formData.get('password') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Read by the on_auth_user_created trigger to seed the profile row.
      data: { username: parsed.data.username, display_name: parsed.data.displayName },
      emailRedirectTo: `${publicEnv.siteUrl.replace(/\/+$/, '')}/api/auth/callback`,
    },
  })

  if (error) {
    // Deliberately not distinguishing "already registered": that would turn
    // this form into an account-enumeration oracle.
    console.error('[registerAction]', error.message)
    return { ok: false, message: 'Бүртгэл үүсгэж чадсангүй. Мэдээллээ шалгаад дахин оролдоно уу.' }
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
    return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    console.error('[loginAction]', error.message)
    return { ok: false, message: 'Email эсвэл нууц үг буруу байна.' }
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

'use client'

import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/validation/env'

/** Browser client. Carries the publishable key; RLS is what protects data. */
export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey)
}

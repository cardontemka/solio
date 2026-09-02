/**
 * Runs once when the server starts (Next.js instrumentation hook).
 *
 * Configuration mistakes should surface at boot with the variable names, not
 * on the first request that happens to touch the misconfigured subsystem. A
 * production deploy without object storage would otherwise serve pages
 * happily until someone opened a book that has images.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { publicEnv } = await import('@/lib/validation/env')
  void publicEnv // throws, naming the variable, if Supabase config is missing

  const { bookImageStorage } = await import('@/lib/storage')
  const storage = bookImageStorage() // throws in production if unconfigured

  if (process.env.NODE_ENV !== 'production' && storage.provider === 'local') {
    console.warn(
      '\n  ⚠  Зургийн сан: LocalDevelopmentStorage (public/uploads).\n' +
        '     Production-д ажиллахгүй. R2 тохируулах: docs/setup.md STEP 5.\n'
    )
  }
}

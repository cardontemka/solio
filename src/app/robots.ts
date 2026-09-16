import type { MetadataRoute } from 'next'
import { publicEnv } from '@/lib/validation/env'

/**
 * What a crawler may read.
 *
 * Everything that is somebody's private view is disallowed rather than merely
 * noindex'd: those pages need a session to render anything at all, so a crawler
 * following them would only ever collect login redirects.
 */
export default function robots(): MetadataRoute.Robots {
  const base = publicEnv.siteUrl.replace(/\/+$/, '')
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin',
        '/dashboard',
        '/my-books',
        '/notifications',
        '/settings',
        '/swaps',
        '/take',
        // A scanned label is a private errand, and the codes are not ours to
        // publish in a search index.
        '/t/',
        '/login',
        '/register',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}

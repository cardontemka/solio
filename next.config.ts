import type { NextConfig } from 'next'

/**
 * The image host is an environment variable, so remotePatterns is derived from
 * it rather than hard-coded. When R2 is not configured (local development),
 * images are served from a relative /uploads path, which needs no entry here.
 *
 * protocol, port, pathname and search are all pinned: omitting them widens the
 * pattern to `**`, which would let anyone route arbitrary URLs through the
 * image optimizer. Each prefix the application writes to gets its own entry —
 * a missing one is not a warning but a 500 on every page that renders the
 * image, so they are listed here beside the code that creates the keys:
 *   · /copies/**  — book photos          (create_image_upload_intent)
 *   · /avatars/** — profile pictures     (/api/uploads/avatar)
 *   · /covers/**  — storage point covers (/api/uploads/cover)
 */
const R2_PREFIXES = ['/copies/**', '/avatars/**', '/covers/**'] as const

function r2RemotePattern() {
  const raw = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  if (!raw) return []
  try {
    const url = new URL(raw)
    return R2_PREFIXES.map((pathname) => ({
      protocol: url.protocol.replace(':', '') as 'https' | 'http',
      hostname: url.hostname,
      port: url.port,
      pathname,
      search: '',
    }))
  } catch {
    throw new Error(
      `NEXT_PUBLIC_R2_PUBLIC_URL is not a valid URL: ${raw}. ` +
        'Expected something like https://images.solio.mn — see docs/setup.md STEP 5.4.'
    )
  }
}

const nextConfig: NextConfig = {
  /**
   * `import { Bell } from '@phosphor-icons/react'` reaches a barrel that
   * re-exports some nine thousand components. The production build shakes them
   * out, but every dev compile and every HMR round walks the whole graph, which
   * is felt as the site crawling while you work on it. This rewrites such
   * imports to their own files so only the icons actually used are ever
   * touched.
   */
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react'],
  },
  /**
   * Testing on a phone means loading the dev server by its address on the local
   * network, and Next blocks cross-origin requests to dev assets by default —
   * the script tags abort, React never hydrates, and the page looks fine while
   * nothing responds to a tap. Development only; it has no effect on a build.
   */
  allowedDevOrigins: [
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*',
    '*.local',
    '*.ngrok-free.app',
  ],
  images: {
    remotePatterns: r2RemotePattern(),
    formats: ['image/avif', 'image/webp'],
    // Next 16 rejects any quality not listed here with a 400.
    qualities: [75],
    // Object keys embed a UUID and are never rewritten, so a long TTL is safe.
    minimumCacheTTL: 2678400,
    // A redirect target is not re-checked against remotePatterns.
    dangerouslyAllowSVG: false,
  },
}

export default nextConfig

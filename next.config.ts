import type { NextConfig } from 'next'

/**
 * The image host is an environment variable, so remotePatterns is derived from
 * it rather than hard-coded. When R2 is not configured (local development),
 * images are served from a relative /uploads path, which needs no entry here.
 *
 * protocol, port, pathname and search are all pinned: omitting them widens the
 * pattern to `**`, which would let anyone route arbitrary URLs through the
 * image optimizer.
 */
function r2RemotePattern() {
  const raw = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  if (!raw) return []
  try {
    const url = new URL(raw)
    return [
      {
        protocol: url.protocol.replace(':', '') as 'https' | 'http',
        hostname: url.hostname,
        port: url.port,
        pathname: '/copies/**',
        search: '',
      },
    ]
  } catch {
    throw new Error(
      `NEXT_PUBLIC_R2_PUBLIC_URL is not a valid URL: ${raw}. ` +
        'Expected something like https://images.solio.mn — see docs/setup.md STEP 5.4.'
    )
  }
}

const nextConfig: NextConfig = {
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

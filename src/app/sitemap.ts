import type { MetadataRoute } from 'next'
import { getSitemapRows } from '@/features/books/queries'
import { publicEnv } from '@/lib/validation/env'

/** Rebuilt hourly: new listings are worth finding, not worth a query per hit. */
export const revalidate = 3600

const STATIC: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/search', priority: 0.8, changeFrequency: 'daily' },
  { path: '/storage-points', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/requests', priority: 0.6, changeFrequency: 'daily' },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicEnv.siteUrl.replace(/\/+$/, '')
  const now = new Date()

  const rows = await getSitemapRows().catch(() => [])

  return [
    ...STATIC.map((s) => ({
      url: `${base}${s.path}`,
      lastModified: now,
      changeFrequency: s.changeFrequency,
      priority: s.priority,
    })),
    ...rows.map((r) => ({
      url: `${base}${r.path}`,
      lastModified: r.updatedAt ? new Date(r.updatedAt) : now,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    })),
  ]
}

import { getCategoryStanding } from '@/features/discovery/queries'
import { CategoryBar } from './CategoryBar'

/**
 * Server wrapper, so the strip's order can come from the database while the
 * strip itself stays a client component that reads the URL.
 *
 * A sibling of SiteHeader rather than something it awaits: React renders the two
 * concurrently, so the ranking costs no round trip that the session was not
 * already spending.
 */
export async function SiteCategoryBar() {
  return <CategoryBar standing={await getCategoryStanding()} />
}

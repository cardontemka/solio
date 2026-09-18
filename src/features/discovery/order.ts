/**
 * Where each category stands. See getCategoryStanding() for how it is filled;
 * this file holds the shape and the sorting because the category strip is a
 * client component — it reads the URL to know which chip is active — so both
 * have to be able to run in the browser.
 */
export type CategoryStanding = Record<string, { score: number; available: number }>

/**
 * Orders categories best-first, and drops the ones with nothing under them.
 *
 * Two rules, and they pull in opposite directions:
 *
 *   · A heading nobody has a book under is a chip that leads to an empty shelf.
 *     It is dropped — the strip is a menu of what this site has, not of what it
 *     could have.
 *   · Except the one currently selected. Filtering by a heading and then having
 *     the chip you filtered by vanish from the strip leaves a page that cannot
 *     say what it is showing, and no way back to "all" except the browser.
 *
 * The canonical list lives in types/domain.ts and is also a CHECK in the
 * database; this never adds to it and never reorders what it keeps beyond the
 * scores. Ties — every heading, on a site with no history yet — keep the order
 * they were given in, so the strip stops rearranging itself once the numbers run
 * out of things to say.
 */
export function orderCategories<T extends string>(
  categories: readonly T[],
  standing: CategoryStanding,
  active?: string | null
): T[] {
  const ranked = categories
    .map((category, index) => ({
      category,
      index,
      score: standing[category]?.score ?? 0,
      available: standing[category]?.available ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)

  const stocked = ranked.filter((entry) => entry.available > 0 || entry.category === active)

  // Nothing survived the filter, which is not the same situation as "these
  // headings are empty": either nobody has listed anything yet, or nobody who
  // has listed anything picked a heading for it — categories are optional on the
  // form. Either way a strip with no headings in it reads as a broken page
  // rather than as an honest empty shelf, so the whole list comes back and the
  // reader can at least see what the headings are.
  return (stocked.length > 0 ? stocked : ranked).map((entry) => entry.category)
}

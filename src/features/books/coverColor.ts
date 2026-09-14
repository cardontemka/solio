/**
 * Deterministic cover colour so a listing looks the same everywhere.
 *
 * FNV-1a rather than the usual `hash*31 + c`: UUIDs share a fixed layout and
 * alphabet, and the weak hash clustered several books onto the same swatch.
 *
 * In its own file, free of `server-only`, because the cards that use it render
 * on both sides of the wire.
 */
export function coverColorFor(id: string): string {
  const palette = [
    '#e76f51', '#f4a261', '#e9c46a', '#b8860b', '#a44a3f',
    '#5d4a3b', '#8a5a3b', '#4a6b5a', '#b56a54', '#c9a35f',
  ]
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return palette[hash % palette.length]
}

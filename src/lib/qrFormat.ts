/**
 * `WPM8RCEF` reads as `WPM8-RCEF`: four characters is what an eye holds.
 *
 * Separate from lib/qr.ts because that one pulls in the encoder and is
 * server-only, while this is needed wherever a code is printed on screen.
 */
export function formatItemCode(code: string) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

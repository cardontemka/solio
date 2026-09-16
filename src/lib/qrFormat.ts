/**
 * The code, exactly as it is stored.
 *
 * It used to be shown grouped as `WPM8-RCEF`, which reads more easily but left
 * people asking whether the dash was part of it — and typing it back in with
 * the dash in the wrong place. The lookup strips punctuation either way, but
 * the displayed form should not raise the question. Letter-spacing in the CSS
 * does the grouping work instead.
 *
 * Separate from lib/qr.ts because that one pulls in the encoder and is
 * server-only, while this is needed wherever a code is printed on screen.
 */
export function formatItemCode(code: string) {
  return code
}

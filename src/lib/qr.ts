import 'server-only'

import QRCode from 'qrcode'
import { publicEnv } from '@/lib/validation/env'

/**
 * The QR on an item's label encodes a URL, not the bare code.
 *
 * That one decision removes the need for a scanner inside the site: every
 * phone's own camera recognises a URL and offers to open it, on iOS as well as
 * Android, where the in-browser barcode API does not exist. The page it opens
 * then does the work. A bare code would be inert in exactly the situation the
 * label exists for — somebody standing in a café holding a book.
 */
export function itemUrlFor(code: string) {
  return `${publicEnv.siteUrl.replace(/\/+$/, '')}/t/${code}`
}

/**
 * The label's QR, as inline SVG.
 *
 * Rendered on the server and dropped straight into the page: no image request,
 * no canvas, and it stays sharp at whatever size it is printed. Error
 * correction M rather than L — a label inside a book cover gets thumbed,
 * creased and coffee-stained, and M tolerates about 15% of the symbol being
 * unreadable for a few percent more density.
 */
export async function qrSvgFor(code: string): Promise<string> {
  return QRCode.toString(itemUrlFor(code), {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })
}

export { formatItemCode } from './qrFormat'

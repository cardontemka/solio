import type { AllowedMime } from './ports'

/**
 * The server never sees the bytes while they are in flight — the browser
 * uploads them directly. So the only honest check is to read the head of the
 * stored object afterwards and confirm it really is the image it claims.
 *
 * A client-declared MIME type is a hint, not evidence.
 */

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false
  return sig.every((b, i) => buf[offset + i] === b)
}

export function sniffMime(buf: Uint8Array): AllowedMime | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  // RIFF....WEBP
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp'
  return null
}

export type Dimensions = { width: number; height: number }

function pngSize(b: Uint8Array): Dimensions | null {
  if (b.length < 24) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return { width: dv.getUint32(16), height: dv.getUint32(20) }
}

function webpSize(b: Uint8Array): Dimensions | null {
  if (b.length < 30) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15])
  if (fourcc === 'VP8 ') {
    return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff }
  }
  if (fourcc === 'VP8L') {
    const bits = dv.getUint32(21, true)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (fourcc === 'VP8X') {
    const w = b[24] | (b[25] << 8) | (b[26] << 16)
    const h = b[27] | (b[28] << 8) | (b[29] << 16)
    return { width: w + 1, height: h + 1 }
  }
  return null
}

function jpegSize(b: Uint8Array): Dimensions | null {
  // Walk the marker chain to the first Start-Of-Frame segment.
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++
      continue
    }
    const marker = b[i + 1]
    // SOF0..SOF15, excluding DHT (c4), JPG (c8) and DAC (cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[i + 5] << 8) | b[i + 6]
      const width = (b[i + 7] << 8) | b[i + 8]
      return { width, height }
    }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len <= 0) return null
    i += 2 + len
  }
  return null
}

export function readDimensions(buf: Uint8Array, mime: AllowedMime): Dimensions | null {
  switch (mime) {
    case 'image/png':
      return pngSize(buf)
    case 'image/webp':
      return webpSize(buf)
    case 'image/jpeg':
      return jpegSize(buf)
  }
}

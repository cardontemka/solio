'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import styles from './CodeEntry.module.css'

/**
 * Pointing a camera at a label, or typing what is printed under it.
 *
 * Two decoders, because one is not enough. `BarcodeDetector` is the browser's
 * own and costs nothing, but it exists on Android and ChromeOS and nowhere on
 * iOS — which is most of the phones anybody would be holding in a café. So when
 * it is missing the frames go through jsQR instead, loaded only at the moment
 * somebody actually presses the button. The camera is offered whenever there is
 * a camera at all, rather than whenever the browser has the fast path.
 *
 * The phone's own camera app still works and needs none of this: the QR encodes
 * a URL, so it opens /t/<code> directly.
 */
function normalise(raw: string) {
  // A pasted link is a code too: "https://solio.mn/t/WPM8RCEF" is what a phone
  // hands somebody who scanned the label.
  const tail = raw.split(/[?#]/)[0].split('/').pop() ?? ''
  return tail
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/I|L/g, '1')
    .replace(/O/g, '0')
    .slice(0, 8)
}

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> }
type DetectorCtor = { new (options: { formats: string[] }): Detector }

function nativeDetector(): DetectorCtor | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector ?? null
}

export function CodeEntry() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const runningRef = useRef(false)

  const code = normalise(value)
  const ready = code.length === 8

  // Whether to offer the camera at all. Read as an external store rather than
  // set from an effect: the answer differs between the server and the browser,
  // and useSyncExternalStore renders the server's answer during hydration and
  // swaps in the real one after, with no mismatch. A camera is all that is
  // required — whether the browser has its own decoder only decides which one
  // runs.
  const canScan = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.mediaDevices?.getUserMedia === 'function',
    () => false
  )

  /** One way out of scanning, used by the button, by errors and by unmount. */
  const stop = useCallback(() => {
    runningRef.current = false
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }
    setScanning(false)
  }, [])

  // Whatever happens — navigation, a thrown frame, closing the tab — the camera
  // light goes out.
  useEffect(() => stop, [stop])

  async function startScan() {
    setError(null)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // The back camera on a phone, and whatever exists on a laptop.
        video: { facingMode: { ideal: 'environment' } },
      })
    } catch (e) {
      const name = (e as { name?: string }).name
      setError(
        name === 'NotAllowedError'
          ? 'Камер ашиглах зөвшөөрөл өгөгдсөнгүй. Хөтчийн хаягийн мөрөн дэх камерын тэмдэг дээр дарж зөвшөөрөх, эсвэл кодыг гараар бичиж болно.'
          : name === 'NotFoundError'
            ? 'Энэ төхөөрөмж дээр камер олдсонгүй. Кодыг гараар бичнэ үү.'
            : 'Камер нээгдсэнгүй. Кодыг гараар бичнэ үү.'
      )
      return
    }

    streamRef.current = stream
    runningRef.current = true
    setScanning(true)

    // The <video> only exists once `scanning` has rendered it.
    await new Promise((r) => requestAnimationFrame(r))
    const video = videoRef.current
    if (!video || !runningRef.current) {
      stop()
      return
    }

    try {
      video.srcObject = stream
      // iOS refuses to play an inline video that is not muted, and refuses to
      // start one at all outside a user gesture — this call is inside the
      // button's own handler, which is what makes it legal.
      video.muted = true
      video.setAttribute('playsinline', '')
      await video.play()
    } catch {
      stop()
      setError('Камерын дүрсийг эхлүүлж чадсангүй. Кодыг гараар бичнэ үү.')
      return
    }

    const Native = nativeDetector()
    const detector = Native ? new Native({ formats: ['qr_code'] }) : null
    // Only pulled in when it is needed, and only where the browser has no
    // decoder of its own: it is 40KB that most Android users never download.
    const jsQR = detector ? null : (await import('jsqr')).default

    const found = (raw: string | null | undefined) => {
      const hit = raw ? normalise(raw) : ''
      if (hit.length !== 8) return false
      stop()
      router.push(`/t/${hit}`)
      return true
    }

    const tick = async () => {
      if (!runningRef.current) return
      try {
        if (detector) {
          const codes = await detector.detect(video)
          for (const c of codes) if (found(c.rawValue)) return
        } else if (jsQR && video.videoWidth > 0) {
          // Downscaled: a 1080p frame is four million pixels to search and the
          // symbol is legible at a fraction of that.
          const canvas = (canvasRef.current ??= document.createElement('canvas'))
          const scale = Math.min(1, 640 / video.videoWidth)
          canvas.width = Math.round(video.videoWidth * scale)
          canvas.height = Math.round(video.videoHeight * scale)
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const hit = jsQR(frame.data, frame.width, frame.height, {
              inversionAttempts: 'dontInvert',
            })
            if (found(hit?.data)) return
          }
        }
      } catch {
        // A frame that cannot be decoded is the normal case, not a failure.
      }
      if (runningRef.current) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  return (
    <div className={styles.wrap}>
      {scanning ? (
        <div className={styles.scanBox}>
          <video ref={videoRef} className={styles.video} muted playsInline />
          <button type="button" className={styles.cancel} onClick={stop}>
            Болих
          </button>
          <p className={styles.aim}>Шошгон дээрх QR-ыг хүрээнд багтаана уу</p>
        </div>
      ) : canScan ? (
        <div className={styles.scanBox}>
          <button type="button" className={styles.scanButton} onClick={startScan}>
            <span className={styles.scanIcon} aria-hidden="true">⌗</span>
            Камераар уншуулах
          </button>
        </div>
      ) : null}

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) router.push(`/t/${code}`)
        }}
      >
        <label className={styles.label} htmlFor="item-code">
          {canScan ? 'Эсвэл шошгон дээрх кодыг бичнэ үү' : 'Шошгон дээрх кодыг бичнэ үү'}
        </label>
        <div className={styles.row}>
          <input
            id="item-code"
            className={styles.input}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            placeholder="WPM8-RCEF"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
          />
          <button type="submit" className={styles.go} disabled={!ready}>
            Үргэлжлүүлэх
          </button>
        </div>
        <p className={styles.hint}>
          {code.length > 0 && !ready
            ? `${code.length}/8 тэмдэгт`
            : 'Утасны камер аппаараа QR-ыг уншуулж бас болно. Код нь 8 тэмдэгт — зураас, том жижиг үсэг хамаагүй.'}
        </p>
      </form>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

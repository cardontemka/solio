'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import styles from './CodeEntry.module.css'

/**
 * Pointing a camera at a label, or typing what is printed under it.
 *
 * Two ways in:
 *
 *   • the phone's own camera app, which needs none of this — the QR encodes a
 *     URL, so scanning it outside the site opens /t/<code> directly;
 *   • a live stream, decoded either by the browser's own BarcodeDetector
 *     (Android, ChromeOS) or by jsQR on canvas frames.
 *
 * There was a third — picking a photograph of the label off the device — and it
 * went: a QR sitting in somebody's camera roll is not a thing that happens, and
 * the button opened a file browser, which read as the site asking for a file
 * upload. When the camera cannot be offered the page says why and falls back to
 * the box, which is the reason the code is eight characters of an alphabet with
 * no I, L, O or U in it.
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

type ScanState = 'ready' | 'insecure' | 'in-app' | 'unsupported'

/** Facebook, Instagram, Line and friends, which run pages in their own webview. */
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Twitter|TikTok/i

function readScanState(): ScanState {
  if (typeof navigator === 'undefined') return 'unsupported'
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure'
    if (IN_APP_BROWSER.test(navigator.userAgent)) return 'in-app'
    return 'unsupported'
  }
  // The API exists but an in-app browser will still refuse it on iOS; warn
  // before the tap rather than after.
  if (IN_APP_BROWSER.test(navigator.userAgent)) return 'in-app'
  return 'ready'
}

// useSyncExternalStore wants a stable snapshot; the answer cannot change
// without a reload, so it is read once and latched.
let latchedScanState: ScanState | null = null
const scanSubscribe = () => () => {}
const scanSnapshot = (): ScanState => (latchedScanState ??= readScanState())
const scanServerSnapshot = (): ScanState => 'unsupported'

const SCAN_BLOCKED_MESSAGE: Record<Exclude<ScanState, 'ready'>, string> = {
  insecure:
    'Энэ хуудас https-ээр нээгдээгүй тул хөтөч камер өгөхгүй байна. solio.mn хаягаар ' +
    'дахин нээж үзнэ үү — эсвэл QR-ын доорх кодыг гараар бичиж болно.',
  'in-app':
    'Instagram, Facebook зэрэг апп доторх хөтчөөс камер нээгдэхгүй. Баруун дээд ' +
    'булан дахь цэгээс «Open in Safari» (эсвэл Chrome) гээд дахин оролдоно уу — ' +
    'эсвэл QR-ын зургийг аваад уншуулж болно.',
  unsupported:
    'Энэ хөтөч камер уншуулахыг дэмжихгүй байна. QR-ын зураг авах, эсвэл доорх ' +
    'кодыг гараар бичнэ үү.',
}

export function CodeEntry({ debug = false }: { debug?: boolean }) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What the scan is actually doing, for the two cases that look identical from
  // the outside: a camera that never delivers a frame, and a camera delivering
  // frames of something that is not a QR.
  const [stats, setStats] = useState<{ frames: number; stalled: boolean } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const runningRef = useRef(false)
  const stallRef = useRef<number | null>(null)

  const code = normalise(value)
  const ready = code.length === 8

  // Whether the camera can be offered, and if not, why. Read as an external
  // store rather than set from an effect: the answer differs between the server
  // and the browser, and useSyncExternalStore renders the server's answer during
  // hydration and swaps in the real one after, with no mismatch.
  //
  // Saying *why* matters more than hiding the button. Two things stop a camera
  // reaching a web page and neither is the page's fault or the reader's:
  //
  //   • a page served over plain http — `navigator.mediaDevices` does not exist
  //     outside a secure context, so the browser never even asks;
  //   • an in-app browser. A link opened inside Instagram or Facebook runs in a
  //     webview that refuses camera access on iOS entirely.
  //
  // Both look identical from in here — no camera — and both have an answer the
  // reader can act on, which is what the message says instead.
  const scanState = useSyncExternalStore(scanSubscribe, scanSnapshot, scanServerSnapshot)
  const canScan = scanState === 'ready'

  /** Decodes whatever is drawn on the shared canvas. */
  const decodeCanvas = useCallback(
    async (draw: (canvas: HTMLCanvasElement) => void, attemptBoth = false) => {
      const jsQR = (await import('jsqr')).default
      const canvas = (canvasRef.current ??= document.createElement('canvas'))
      draw(canvas)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const hit = jsQR(frame.data, frame.width, frame.height, {
        inversionAttempts: attemptBoth ? 'attemptBoth' : 'dontInvert',
      })
      return hit?.data ?? null
    },
    []
  )

  /** One way out of scanning, used by the button, by errors and by unmount. */
  const stop = useCallback(() => {
    runningRef.current = false
    if (stallRef.current !== null) {
      clearInterval(stallRef.current)
      stallRef.current = null
    }
    setStats(null)
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
    setStats({ frames: 0, stalled: false })
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

    // A camera that opens and then hands over nothing is the failure people
    // describe as "it just doesn't work". Counted here so the page can say
    // which of the two is happening instead of sitting there.
    let frames = 0
    const startedAt = Date.now()
    const stallCheck = window.setInterval(() => {
      if (!runningRef.current) return
      setStats({ frames, stalled: Date.now() - startedAt > 8000 })
    }, 1000)
    stallRef.current = stallCheck

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
        if (video.videoWidth > 0) frames += 1
        if (detector) {
          const codes = await detector.detect(video)
          for (const c of codes) if (found(c.rawValue)) return
        } else if (video.videoWidth > 0) {
          // Downscaled: a 1080p frame is four million pixels to search and the
          // symbol is legible at a fraction of that.
          const raw = await decodeCanvas((canvas) => {
            const scale = Math.min(1, 640 / video.videoWidth)
            canvas.width = Math.round(video.videoWidth * scale)
            canvas.height = Math.round(video.videoHeight * scale)
            canvas
              .getContext('2d', { willReadFrequently: true })
              ?.drawImage(video, 0, 0, canvas.width, canvas.height)
          })
          if (found(raw)) return
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
          <p className={styles.aim}>
            {stats?.stalled
              ? stats.frames === 0
                ? 'Камер зураг өгөхгүй байна. Болих дараад «QR-ын зураг авах»-ыг туршина уу.'
                : 'Уншсангүй. QR бүтнээрээ хүрээнд багтаж, тод байх ёстой — эсвэл зураг авч уншуулна уу.'
              : 'QR-ыг хүрээнд багтаана уу'}
          </p>
        </div>
      ) : (
        <div className={styles.scanBox}>
          {canScan ? (
            <button type="button" className={styles.scanButton} onClick={startScan}>
              <span className={styles.scanIcon} aria-hidden="true">⌗</span>
              Камераар уншуулах
            </button>
          ) : (
            <p className={styles.blocked}>{SCAN_BLOCKED_MESSAGE[scanState]}</p>
          )}
        </div>
      )}

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) router.push(`/t/${code}`)
        }}
      >
        <label className={styles.label} htmlFor="item-code">
          {canScan ? 'Эсвэл QR-ын доорх кодыг бичнэ үү' : 'QR-ын доорх кодыг бичнэ үү'}
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
            placeholder="WPM8RCEF"
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

      {/* Add ?debug to the address to see what the browser is actually
          offering. The whole site already uses that switch (see layout.tsx):
          a phone has no console, and "it doesn't work" is not a symptom
          anybody can act on. */}
      {debug && (
        <p className={styles.debug}>
          secure:{String(typeof window !== 'undefined' && window.isSecureContext)} · media:
          {String(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia)} ·
          detector:{String(typeof window !== 'undefined' && 'BarcodeDetector' in window)} · state:
          {scanState} · frames:{stats?.frames ?? 0}
        </p>
      )}
    </div>
  )
}

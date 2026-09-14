'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './CodeEntry.module.css'

/**
 * Typing in a code, or pointing a camera at one.
 *
 * The box is the mechanism; the camera is a convenience that is simply absent
 * on most desktops. BarcodeDetector ships on Android and ChromeOS and is
 * missing from Safari and from Chrome on macOS, so the button that offers it
 * only appears once the browser has actually admitted to having it — an offer
 * that does nothing when pressed is worse than no offer.
 *
 * The label's QR encodes a URL, so the path that always works is the phone's
 * own camera app: it opens /t/<code> directly and never comes here.
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

type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
}
type DetectorCtor = {
  new (options: { formats: string[] }): Detector
  getSupportedFormats?: () => Promise<string[]>
}

function detectorCtor(): DetectorCtor | null {
  if (typeof window === 'undefined') return null
  const ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
  if (!ctor) return null
  if (!navigator.mediaDevices?.getUserMedia) return null
  return ctor
}

export function CodeEntry() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const [canScan, setCanScan] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const runningRef = useRef(false)

  const code = normalise(value)
  const ready = code.length === 8

  // Asked after mount, never during render: the answer differs between the
  // server and the browser, and getSupportedFormats is a promise besides.
  useEffect(() => {
    let alive = true
    const ctor = detectorCtor()
    if (!ctor) return
    const ask = ctor.getSupportedFormats?.() ?? Promise.resolve(['qr_code'])
    ask
      .then((formats) => {
        if (alive && formats.includes('qr_code')) setCanScan(true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

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
    const Ctor = detectorCtor()
    if (!Ctor) {
      setCanScan(false)
      setError(
        'Энэ төхөөрөмж дээрээс QR уншиж чадахгүй байна. Утасныхаа камер аппаар шошгыг ' +
          'уншуулбал шууд нээгдэнэ — эсвэл кодыг нь доор бичнэ үү.'
      )
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
    } catch (e) {
      const name = (e as { name?: string }).name
      setError(
        name === 'NotAllowedError'
          ? 'Камер ашиглах зөвшөөрөл өгөгдсөнгүй. Кодыг гараар бичиж болно.'
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
      await video.play()
    } catch {
      stop()
      setError('Камерын дүрсийг эхлүүлж чадсангүй. Кодыг гараар бичнэ үү.')
      return
    }

    const detector = new Ctor({ formats: ['qr_code'] })
    const tick = async () => {
      if (!runningRef.current) return
      try {
        const found = await detector.detect(video)
        const hit = found.map((f) => normalise(f.rawValue)).find((c) => c.length === 8)
        if (hit) {
          stop()
          router.push(`/t/${hit}`)
          return
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
          {canScan || scanning ? 'Эсвэл шошгон дээрх кодыг бичнэ үү' : 'Шошгон дээрх кодыг бичнэ үү'}
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

'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'
import styles from './CopyCarousel.module.css'

type Slide = { id: string; url: string }

/**
 * Touch-swipeable image carousel. Uses CSS scroll-snap for native swipe/drag and
 * exposes arrows + dots that scroll a given slide into view.
 */
export function CopyCarousel({ images, alt }: { images: Slide[]; alt: string }) {
  const trackRef = useRef<HTMLUListElement>(null)
  const [index, setIndex] = useState(0)

  if (images.length === 0) return null
  const count = images.length

  function scrollTo(i: number) {
    const track = trackRef.current
    if (!track) return
    const next = Math.max(0, Math.min(count - 1, i))
    track.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({
      behavior: 'smooth',
      inline: 'start',
      block: 'nearest',
    })
  }

  function onScroll() {
    const track = trackRef.current
    if (!track) return
    const width = track.clientWidth
    const i = Math.round(track.scrollLeft / width)
    if (i !== index) setIndex(Math.max(0, Math.min(count - 1, i)))
  }

  return (
    <div className={styles.carousel}>
      <ul
        ref={trackRef}
        className={styles.track}
        onScroll={onScroll}
        aria-label="Зураг"
      >
        {images.map((img, i) => (
          <li key={img.id} className={styles.slide} data-index={i}>
            <Image
              src={img.url}
              alt={`${alt} — зураг ${i + 1}`}
              fill
              sizes="(max-width: 920px) 92vw, 460px"
              draggable={false}
              /* The first slide is the whole point of this page and is on screen
                 before anything is scrolled — it is the LCP, so it is fetched
                 eagerly. The rest wait until they are swiped to. */
              priority={i === 0}
              unoptimized
            />
          </li>
        ))}
      </ul>

      {count > 1 && (
        <>
          <button
            type="button"
            className={`${styles.arrow} ${styles.prev}`}
            aria-label="Өмнөх зураг"
            onClick={() => scrollTo(index - 1)}
            disabled={index === 0}
          >
            ‹
          </button>
          <button
            type="button"
            className={`${styles.arrow} ${styles.next}`}
            aria-label="Дараагийн зураг"
            onClick={() => scrollTo(index + 1)}
            disabled={index === count - 1}
          >
            ›
          </button>

          <div className={styles.dots} role="tablist" aria-label="Зураг сонгох">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Зураг ${i + 1}`}
                className={styles.dot}
                data-active={i === index}
                onClick={() => scrollTo(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
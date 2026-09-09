import Image from 'next/image'
import styles from './Avatar.module.css'

/**
 * A person's picture, or their initial when they have not set one. Always
 * round, always the same sizes, so avatars line up wherever they appear.
 */
export function Avatar({
  name,
  src,
  size = 32,
}: {
  name: string
  src?: string | null
  size?: number
}) {
  return (
    <span
      className={styles.avatar}
      style={{ '--size': `${size}px`, '--font': `${Math.round(size * 0.42)}px` } as React.CSSProperties}
      aria-hidden="true"
    >
      {src ? (
        <Image
          className={styles.image}
          src={src}
          alt=""
          width={size * 2}
          height={size * 2}
          unoptimized
        />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  )
}

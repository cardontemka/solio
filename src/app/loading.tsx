import styles from './loading.module.css'

/**
 * Shown while a route's data is being fetched.
 *
 * Every page here is dynamic — they all read the session — so navigation always
 * waits on the server. Without this the browser sat on the old page with no
 * sign that anything was happening. Next swaps this in the moment a link is
 * clicked, so the feedback is instant even when the data is not.
 *
 * A skeleton rather than a spinner: it holds roughly the shape of what is
 * coming, so the page does not jump when the real content lands.
 */
export default function Loading() {
  return (
    <div className="container" aria-busy="true" aria-live="polite">
      <span className={styles.srOnly}>Ачаалж байна…</span>

      <div className={styles.bar} />

      <div className={styles.head}>
        <div className={styles.line} style={{ width: '38%', height: 26 }} />
        <div className={styles.line} style={{ width: '58%' }} />
      </div>

      <div className={styles.grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.card}>
            <div className={styles.cover} />
            <div className={styles.line} style={{ width: '85%' }} />
            <div className={styles.line} style={{ width: '55%' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

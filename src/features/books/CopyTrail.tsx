import Link from 'next/link'
import type { TrailStep } from './queries'
import styles from './CopyTrail.module.css'

const WHAT: Record<TrailStep['eventType'], string> = {
  initial_registration: 'бүртгэсэн',
  swap_transfer: 'солилцоогоор',
  claim_transfer: 'гараас гарт',
  admin_correction: 'админ залруулсан',
}

/**
 * The hands a copy has passed through.
 *
 * Read as a chain rather than a table: the interesting thing is the sequence,
 * not the dates, and a book that has been through four people should look like
 * it has. The first row is the registration — somebody putting it on the site —
 * and every row after it is one handover.
 */
export function CopyTrail({ steps, owners }: { steps: TrailStep[]; owners: number }) {
  if (steps.length === 0) return null

  return (
    <div className={styles.wrap}>
      <p className={styles.lead}>
        {owners > 1
          ? `Энэ зүйл ${owners} хүний гарт байсан.`
          : 'Энэ зүйл эхний эзэмшигчийнхээ гарт байна.'}
      </p>
      <ol className={styles.list}>
        {steps.map((step, i) => (
          <li key={`${step.occurredAt}-${i}`} className={styles.step}>
            <span className={styles.dot} aria-hidden="true" />
            <div className={styles.body}>
              <p className={styles.who}>
                {step.fromUsername && step.fromName ? (
                  <>
                    <Link href={`/u/${step.fromUsername}`}>{step.fromName}</Link>
                    <span className={styles.arrow} aria-hidden="true"> → </span>
                  </>
                ) : null}
                <Link href={`/u/${step.toUsername}`}>{step.toName}</Link>
              </p>
              <p className={styles.meta}>
                {WHAT[step.eventType]} · {step.occurredAt}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

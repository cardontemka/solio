import Link from 'next/link'
import { PlusIcon, ScanIcon } from './Icons'
import styles from './FloatingActions.module.css'

/**
 * The two things you can do to your shelf from anywhere: put something on it,
 * or record something that has come into your hands.
 *
 * "Авах" is the quieter of the pair — adding is the commoner act, and a second
 * filled button beside the first would make neither read as the primary one. On
 * a phone both collapse to circles, stacked, with the same hit area a thumb
 * expects.
 */
export function AddBookFab() {
  return (
    <div className={styles.stack}>
      <Link href="/take" className={styles.fabGhost} aria-label="Ном, пянз авсныг бүртгэх">
        <ScanIcon size={21} />
        <span className={styles.fabLabel}>Авах</span>
      </Link>
      <Link href="/books/new" className={styles.fab} aria-label="Ном, пянз нэмэх">
        <PlusIcon size={24} />
        <span className={styles.fabLabel}>Нэмэх</span>
      </Link>
    </div>
  )
}

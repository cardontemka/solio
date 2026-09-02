import Link from 'next/link'
import { PlusIcon } from './Icons'
import styles from './FloatingActions.module.css'

/** Globally-visible "add a book" action, fixed to the bottom-right corner. */
export function AddBookFab() {
  return (
    <Link href="/books/new" className={styles.fab} aria-label="Ном нэмэх">
      <PlusIcon size={24} />
      <span className={styles.fabLabel}>Ном нэмэх</span>
    </Link>
  )
}
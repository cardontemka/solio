'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { confirmReceiptByCodeAction } from './actions'
import type { SwapReceipt } from './queries'
import styles from './ConfirmReceipt.module.css'

/**
 * The end of a swap, on the page a scanned label opens.
 *
 * This is the only place a handover can be confirmed. The old pair of buttons
 * on /swaps asked two people to assert something about the physical world from
 * wherever they happened to be; a scan cannot be done without the object, which
 * is the whole point of printing a code on it.
 */
export function ConfirmReceipt({ code, receipt }: { code: string; receipt: SwapReceipt }) {
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'confirmed' | null>(null)
  const [pending, start] = useTransition()

  if (done || (receipt.viewerReceives && receipt.viewerConfirmed)) {
    return (
      <div className={styles.doneBox}>
        <h2 className={styles.title}>Хүлээн авсныг баталгаажууллаа</h2>
        <p className={styles.body}>
          {receipt.otherName} өөрийн авсан зүйлийнхээ шошгыг уншуулахад солилцоо дуусаж,
          эзэмшил хоёр тал дээр шилжинэ.
        </p>
        <Link href="/swaps" className={styles.link}>
          Солилцоо хэсэг рүү →
        </Link>
      </div>
    )
  }

  // The other side's book. Scanning it proves nothing — they are the ones who
  // must be holding it — so the page says so rather than offering a button that
  // would be refused.
  if (!receipt.viewerReceives) {
    return (
      <div className={styles.box}>
        <h2 className={styles.title}>Энэ бол таны өгч буй зүйл</h2>
        <p className={styles.body}>
          Энэ солилцоонд та үүнийг {receipt.otherName}-д өгч байна. Та өөрийн хүлээн авсан
          зүйлийнхээ шошгыг уншуулж баталгаажуулна.
        </p>
        <Link href="/swaps" className={styles.link}>
          Солилцоог харах →
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.box}>
      <h2 className={styles.title}>Биечлэн хүлээн авсан уу?</h2>
      <p className={styles.body}>
        «{receipt.title}»-ийг {receipt.otherName}-аас хүлээн авсан бол баталгаажуулна уу.
        Хоёул баталгаажуулмагц эзэмшил шилжинэ.
      </p>
      <button
        type="button"
        className={styles.confirm}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null)
            const r = await confirmReceiptByCodeAction(code)
            if (!r.ok) setError(r.message ?? 'Болсонгүй.')
            else setDone('confirmed')
          })
        }
      >
        {pending ? 'Баталгаажуулж байна…' : 'Тийм, гартаа авлаа'}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

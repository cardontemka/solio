'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { BookCover } from '@/components/BookCard'
import { coverColorFor } from '@/features/books/coverColor'
import { formatItemCode } from '@/lib/qrFormat'
import { respondToClaimAction } from './actions'
import type { Claim } from './queries'
import styles from './ClaimList.module.css'

const STATUS_LABEL: Record<Claim['status'], string> = {
  pending: 'Хүлээгдэж байна',
  approved: 'Зөвшөөрсөн',
  rejected: 'Татгалзсан',
  expired: 'Хугацаа дууссан',
  cancelled: 'Буцаасан',
}

/** "Тав хоногийн дараа" is no use; "3 хоног" is what a deadline means. */
function daysLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return null
  const days = Math.floor(ms / 86400000)
  if (days >= 1) return `${days} хоног үлдсэн`
  const hours = Math.max(1, Math.floor(ms / 3600000))
  return `${hours} цаг үлдсэн`
}

/**
 * What this claim is, in a sentence, from the reader's side of it.
 *
 * Three different things wear the same word in English — a café taking a book
 * in for safekeeping, somebody giving a book to a café, somebody taking one off
 * a café's shelf — and only the third costs a credit. Saying "авсан" for all
 * three would hide the one difference that matters.
 */
function claimSentence(c: Claim) {
  const venue = c.kind === 'storage' ? c.claimantPoint : (c.claimantPoint ?? c.ownerPoint)
  if (c.role === 'owner') {
    if (c.kind === 'storage') return { verb: 'хадгалж авсан гэж байна', who: venue ?? c.otherName }
    if (c.claimantPoint)
      return { verb: 'хандив болгон авсан гэж байна', who: c.claimantPoint, credit: '+1 оноо' }
    return { verb: 'авах хүсэлт илгээсэн', who: c.otherName }
  }
  if (c.kind === 'storage') return { verb: 'дээр хадгалж авлаа', who: c.otherName, mine: true }
  if (c.claimantPoint)
    return { verb: '-аас хандив болгон авлаа', who: c.otherName, mine: true }
  if (c.ownerPoint)
    return { verb: '-ээс авах хүсэлт', who: c.ownerPoint, mine: true, credit: '−1 оноо' }
  return { verb: '-аас авах хүсэлт илгээлээ', who: c.otherName, mine: true }
}

export function ClaimList({ claims }: { claims: Claim[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function act(claimId: string, action: 'approve' | 'reject' | 'cancel') {
    setError(null)
    setBusy(claimId)
    start(async () => {
      const r = await respondToClaimAction(claimId, action)
      if (!r.ok) setError(r.message)
      setBusy(null)
    })
  }

  return (
    <>
      <ul className={styles.list}>
        {claims.map((c) => {
          const said = claimSentence(c)
          const left = c.status === 'pending' ? daysLeft(c.expiresAt) : null
          return (
            <li key={c.claimId} className={styles.row} data-status={c.status}>
              <Link href={`/books/${c.copyId}`} className={styles.thumb}>
                <BookCover
                  title={c.title}
                  author={c.author}
                  color={coverColorFor(c.copyId)}
                  src={c.imageUrl}
                  size="sm"
                  kind={c.itemKind}
                />
              </Link>

              <div className={styles.body}>
                <Link href={`/books/${c.copyId}`} className={styles.title}>
                  {c.title}
                </Link>
                <p className={styles.what}>
                  <Link href={`/u/${c.otherUsername}`} className={styles.who}>
                    {said.who}
                  </Link>
                  {said.verb.startsWith('-') || said.verb.startsWith('\u2212') ? '' : ' '}
                  {said.verb}
                  {said.credit && <span className={styles.credit}>{said.credit}</span>}
                </p>
                {c.note && <p className={styles.note}>«{c.note}»</p>}
                <p className={styles.meta}>
                  <span className={styles.code}>{formatItemCode(c.code)}</span>
                  {' · '}
                  <span className={styles.status}>{STATUS_LABEL[c.status]}</span>
                  {left && ` · ${left}`}
                </p>
              </div>

              {c.status === 'pending' && (
                <div className={styles.actions}>
                  {c.role === 'owner' ? (
                    <>
                      <button
                        type="button"
                        className={styles.approve}
                        disabled={pending && busy === c.claimId}
                        onClick={() => act(c.claimId, 'approve')}
                      >
                        Зөвшөөрөх
                      </button>
                      <button
                        type="button"
                        className={styles.reject}
                        disabled={pending && busy === c.claimId}
                        onClick={() => act(c.claimId, 'reject')}
                      >
                        Татгалзах
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.reject}
                      disabled={pending && busy === c.claimId}
                      onClick={() => act(c.claimId, 'cancel')}
                    >
                      Буцаах
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p className={styles.error}>{error}</p>}
    </>
  )
}

'use client'

import { useActionState, useState, useTransition } from 'react'
import { deleteReviewAction, upsertReviewAction, type ReviewState } from './actions'
import type { ReviewView } from './queries'
import styles from './ReviewSection.module.css'

const initial: ReviewState = { ok: false }

function Stars({ value }: { value: number }) {
  return (
    <span className={styles.stars} aria-label={`${value} / 5`}>
      {'★'.repeat(value)}
      <span className={styles.dim}>{'★'.repeat(5 - value)}</span>
    </span>
  )
}

function RatingInput({ defaultValue }: { defaultValue: number }) {
  const [value, setValue] = useState(defaultValue)
  return (
    <div className={styles.picker}>
      <input type="hidden" name="rating" value={value} />
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={styles.star}
          data-on={n <= value}
          aria-label={`${n} од`}
          aria-pressed={n === value}
          onClick={() => setValue(n)}
        >
          ★
        </button>
      ))}
      <span className={styles.pickerValue}>{value} / 5</span>
    </div>
  )
}

export function ReviewSection({
  bookId,
  reviews,
  myReview,
  canReview,
}: {
  bookId: string
  reviews: ReviewView[]
  myReview: { id: string; rating: number; body: string | null } | null
  canReview: boolean
}) {
  const [state, formAction, pending] = useActionState(upsertReviewAction, initial)
  const [editing, setEditing] = useState(false)
  const [deleting, startDelete] = useTransition()
  const showForm = canReview && (editing || !myReview)

  return (
    <section className={styles.wrap}>
      <h2 className={styles.title}>Сэтгэгдэл ({reviews.length})</h2>

      {!canReview && (
        <p className={styles.hint}>Сэтгэгдэл бичихийн тулд нэвтэрнэ үү.</p>
      )}

      {showForm && (
        <form action={formAction} className={styles.form}>
          <input type="hidden" name="bookId" value={bookId} />
          <RatingInput defaultValue={myReview?.rating ?? 5} />
          <textarea
            name="body"
            className={styles.textarea}
            rows={3}
            maxLength={4000}
            defaultValue={myReview?.body ?? ''}
            placeholder="Энэ номын талаар юу бодож байна? (заавал биш)"
          />
          {!state.ok && state.message && <p className={styles.error}>{state.message}</p>}
          <div className={styles.row}>
            <button type="submit" className={styles.submit} disabled={pending}>
              {pending ? 'Хадгалж байна…' : myReview ? 'Шинэчлэх' : 'Сэтгэгдэл үлдээх'}
            </button>
            {myReview && (
              <button type="button" className={styles.ghost} onClick={() => setEditing(false)}>
                Болих
              </button>
            )}
          </div>
        </form>
      )}

      {myReview && !editing && canReview && (
        <div className={styles.mine}>
          <span className={styles.mineLabel}>Таны үнэлгээ</span>
          <Stars value={myReview.rating} />
          <button type="button" className={styles.ghost} onClick={() => setEditing(true)}>
            Засах
          </button>
          <button
            type="button"
            className={styles.ghost}
            disabled={deleting}
            onClick={() => startDelete(async () => { await deleteReviewAction(myReview.id, bookId) })}
          >
            {deleting ? '…' : 'Устгах'}
          </button>
        </div>
      )}

      {reviews.length === 0 ? (
        <p className={styles.hint}>Одоогоор сэтгэгдэл байхгүй байна.</p>
      ) : (
        <ul className={styles.list}>
          {reviews.map((r) => (
            <li key={r.id} className={styles.item} data-hidden={r.isHidden}>
              <div className={styles.head}>
                <span className={styles.avatar} aria-hidden="true">{r.authorName.charAt(0)}</span>
                <div>
                  <p className={styles.author}>
                    {r.authorName}
                    {r.isMine && <span className={styles.you}>та</span>}
                  </p>
                  <p className={styles.date}>{r.createdAt}</p>
                </div>
                <Stars value={r.rating} />
              </div>
              {r.isHidden && (
                <p className={styles.hiddenNote}>
                  Энэ сэтгэгдлийг модератор нуусан — зөвхөн танд харагдаж байна.
                </p>
              )}
              {r.body && <p className={styles.body}>{r.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

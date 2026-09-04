'use client'

import Link from 'next/link'
import { Avatar } from '@/components/Avatar'
import { useActionState, useEffect, useRef, useTransition } from 'react'
import { addCommentAction, deleteCommentAction, type CommentState } from './actions'
import type { CommentView } from './queries'
import styles from './CommentSection.module.css'

const initial: CommentState = { ok: false }

/**
 * A plain comment thread. Anyone signed in may leave as many as they like; the
 * database rate-limits, and the author may delete their own.
 */
export function CommentSection({
  target,
  comments,
  canComment,
  viewerId,
  path,
}: {
  /** Exactly one: the listing or the request this thread belongs to. */
  target: { listingId: string } | { requestId: string }
  comments: CommentView[]
  canComment: boolean
  viewerId: string | null
  /** The page to revalidate after a delete. */
  path: string
}) {
  const [state, formAction, pending] = useActionState(addCommentAction, initial)
  const [deleting, startDelete] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  // Clear the box once the server has accepted the comment. In an effect
  // rather than during render: touching a ref while rendering is exactly the
  // impurity React's lint rule is there to catch.
  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  return (
    <section className={styles.wrap}>
      <h2 className={styles.title}>Сэтгэгдэл ({comments.length})</h2>

      {canComment ? (
        <form ref={formRef} action={formAction} className={styles.form}>
          {'listingId' in target ? (
            <input type="hidden" name="listingId" value={target.listingId} />
          ) : (
            <input type="hidden" name="requestId" value={target.requestId} />
          )}
          <textarea
            className={styles.textarea}
            name="body"
            rows={3}
            maxLength={4000}
            required
            placeholder="Энэ номын талаар бичих…"
          />
          {!state.ok && state.errors?.body && (
            <p className={styles.error}>{state.errors.body[0]}</p>
          )}
          {!state.ok && state.message && <p className={styles.error}>{state.message}</p>}
          <div className={styles.formActions}>
            <button className={styles.submit} type="submit" disabled={pending}>
              {pending ? 'Илгээж байна…' : 'Сэтгэгдэл нэмэх'}
            </button>
          </div>
        </form>
      ) : (
        <p className={styles.signedOut}>
          Сэтгэгдэл бичихийн тулд <Link href="/login">нэвтэрнэ үү</Link>.
        </p>
      )}

      {comments.length === 0 ? (
        <p className={styles.empty}>Одоогоор сэтгэгдэл байхгүй.</p>
      ) : (
        <ul className={styles.list}>
          {comments.map((c) => (
            <li key={c.id} className={styles.item} data-hidden={c.isHidden}>
              <div className={styles.head}>
                <Link href={`/u/${c.authorUsername}`} className={styles.author}>
                  <Avatar name={c.authorName} src={c.authorAvatarUrl} size={26} />
                  {c.authorName}
                </Link>
                <span className={styles.date}>{c.createdAt}</span>
                {c.isHidden && <span className={styles.hiddenNote}>Модерацлагдсан</span>}
                {c.isMine && viewerId && (
                  <button
                    type="button"
                    className={styles.delete}
                    disabled={deleting}
                    onClick={() =>
                      startDelete(async () => {
                        await deleteCommentAction(c.id, path)
                      })
                    }
                  >
                    Устгах
                  </button>
                )}
              </div>
              <p className={styles.body}>{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

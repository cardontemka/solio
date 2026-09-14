'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useActionState, useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { addCommentAction, deleteCommentAction, type CommentState } from './actions'
import type { CommentView } from './queries'
import styles from './CommentSection.module.css'

const initial: CommentState = { ok: false }

export type CommentTarget = { listingId: string } | { requestId: string }

/** One of the viewer's own listings, offered as an answer to a request. */
export type OfferableListing = { copyId: string; title: string }

function OfferedCard({ offered }: { offered: NonNullable<CommentView['offered']> }) {
  return (
    <Link href={`/books/${offered.copyId}`} className={styles.offered}>
      <span className={styles.offeredThumb}>
        {offered.imageUrl ? (
          <Image src={offered.imageUrl} alt="" width={72} height={96} unoptimized />
        ) : (
          <span className={styles.offeredEmpty} aria-hidden="true" />
        )}
      </span>
      <span className={styles.offeredText}>
        <span className={styles.offeredLabel}>Энэ мөн үү?</span>
        <span className={styles.offeredTitle}>{offered.title}</span>
      </span>
    </Link>
  )
}

function TargetFields({
  target,
  parentId,
  replyToId,
}: {
  target: CommentTarget
  parentId?: string
  replyToId?: string
}) {
  return (
    <>
      {'listingId' in target ? (
        <input type="hidden" name="listingId" value={target.listingId} />
      ) : (
        <input type="hidden" name="requestId" value={target.requestId} />
      )}
      {parentId && <input type="hidden" name="parentId" value={parentId} />}
      {replyToId && <input type="hidden" name="replyToId" value={replyToId} />}
    </>
  )
}

/**
 * One comment, its replies, and the controls the reader is entitled to.
 *
 * The id is on the article so a notification can link straight to it —
 * scroll-margin-top in the stylesheet keeps the sticky header off it.
 */
function Comment({
  comment,
  target,
  path,
  canComment,
  depth = 0,
  rootId,
}: {
  comment: CommentView
  target: CommentTarget
  path: string
  canComment: boolean
  depth?: number
  /**
   * The comment at the top of this thread. A reply to a reply is filed under the
   * root — the nesting stops at one level, because a thread that indents forever
   * is unreadable on a phone — while `replyToId` records who is actually being
   * answered, so the page can say so.
   */
  rootId?: string
}) {
  const [replying, setReplying] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [state, formAction, pending] = useActionState(addCommentAction, initial)
  const [deleteState, deleteAction, deleting] = useActionState(
    async () => deleteCommentAction(comment.id, path),
    initial
  )

  // Close the reply box once the server accepted it. A render-time adjustment
  // rather than an effect: reacting to the new state in an effect commits twice
  // for one render, which is what React's lint rule flags.
  const [seen, setSeen] = useState(state)
  if (seen !== state) {
    setSeen(state)
    if (state.ok) setReplying(false)
  }

  return (
    <li className={styles.item} data-hidden={comment.isHidden} data-depth={depth}>
      <article id={`comment-${comment.id}`} className={styles.article}>
        <div className={styles.head}>
          <Link href={`/u/${comment.authorUsername}`} className={styles.author}>
            <Avatar name={comment.authorName} src={comment.authorAvatarUrl} size={26} />
            {comment.authorName}
          </Link>
          <span className={styles.date}>{comment.createdAt}</span>
          {comment.isHidden && <span className={styles.hiddenNote}>Модерацлагдсан</span>}
        </div>

        {comment.replyToName && (
          <p className={styles.replyTo}>
            <span aria-hidden="true">↳ </span>
            {comment.replyToName}-д хариулав
          </p>
        )}

        <p className={styles.body}>{comment.body}</p>
        {comment.offered && <OfferedCard offered={comment.offered} />}

        <div className={styles.actions}>
          {canComment && (
            <button type="button" className={styles.link} onClick={() => setReplying((v) => !v)}>
              {replying ? 'Болих' : 'Хариу бичих'}
            </button>
          )}
          {comment.isMine &&
            (confirming ? (
              <form action={deleteAction}>
                <button type="submit" className={styles.confirm} disabled={deleting}>
                  {deleting ? 'Устгаж байна…' : 'Устгахдаа итгэлтэй?'}
                </button>
              </form>
            ) : (
              <button type="button" className={styles.delete} onClick={() => setConfirming(true)}>
                Устгах
              </button>
            ))}
        </div>

        {!deleteState.ok && deleteState.message && (
          <p className={styles.error}>{deleteState.message}</p>
        )}

        {replying && (
          <form action={formAction} className={styles.replyForm}>
            {/* Filed under the root; addressed to whoever is being answered. */}
            <TargetFields
              target={target}
              parentId={rootId ?? comment.id}
              replyToId={comment.id}
            />
            <textarea
              className={styles.textarea}
              name="body"
              rows={2}
              maxLength={4000}
              required
              autoFocus
              placeholder={`${comment.authorName}-д хариу бичих…`}
            />
            {!state.ok && state.errors?.body && (
              <p className={styles.error}>{state.errors.body[0]}</p>
            )}
            {!state.ok && state.message && <p className={styles.error}>{state.message}</p>}
            <div className={styles.formActions}>
              <button className={styles.submit} type="submit" disabled={pending}>
                {pending ? 'Илгээж байна…' : 'Хариу илгээх'}
              </button>
            </div>
          </form>
        )}
      </article>

      {comment.replies.length > 0 && (
        <ul className={styles.replies}>
          {comment.replies.map((r) => (
            <Comment
              key={r.id}
              comment={r}
              target={target}
              path={path}
              canComment={canComment}
              depth={depth + 1}
              rootId={rootId ?? comment.id}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * A plain comment thread with one level of replies. Anyone signed in may leave
 * as many as they like; the database rate-limits, and the author may delete
 * their own.
 */
export function CommentSection({
  target,
  comments,
  canComment,
  viewerId,
  path,
  offerable = [],
  subject = 'зүйл',
  subjectOf = 'зүйлийн',
}: {
  target: CommentTarget
  comments: CommentView[]
  canComment: boolean
  viewerId: string | null
  path: string
  /** The viewer's own listings, offered on a request thread only. */
  offerable?: OfferableListing[]
  /**
   * What the thread is about, in the words of the page it is on — "ном",
   * "пянз", "хүсэлт". Every prompt here used to say "ном", which was wrong on
   * a record's page and wrong again on a request's.
   *
   * Both cases are passed rather than one being built from the other: Mongolian
   * genitive endings do not follow from the nominative reliably enough to glue
   * on in code — "ном" takes -ын and "пянз" takes -ны.
   */
  subject?: string
  subjectOf?: string
}) {
  const it = subject.toLowerCase()
  const itsOf = subjectOf.toLowerCase()
  const [state, formAction, pending] = useActionState(addCommentAction, initial)
  const formRef = useRef<HTMLFormElement>(null)

  // Clear the box once the server has accepted the comment. In an effect
  // rather than during render: touching a ref while rendering is exactly the
  // impurity React's lint rule is there to catch.
  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  const total = comments.reduce((n, c) => n + 1 + c.replies.length, 0)

  return (
    <section className={styles.wrap} id="comments">
      <h2 className={styles.title}>Сэтгэгдэл ({total})</h2>

      {canComment ? (
        <form ref={formRef} action={formAction} className={styles.form}>
          <TargetFields target={target} />
          <textarea
            className={styles.textarea}
            name="body"
            rows={3}
            maxLength={4000}
            required
            placeholder={
              offerable.length > 0
                ? `Энэ ${it} танд байна уу? Хариу бичих…`
                : `Энэ ${itsOf} талаар бичих…`
            }
          />

          {/* Answering a request with a book is the point of the thread, so the
              picker sits in the reply box rather than somewhere separate. */}
          {offerable.length > 0 && (
            <label className={styles.offerPick}>
              <span className={styles.offerPickLabel}>Өөрийнхөө нэгийг хавсаргах</span>
              <select className={styles.offerSelect} name="offeredCopyId" defaultValue="">
                <option value="">— сонгохгүй —</option>
                {offerable.map((o) => (
                  <option key={o.copyId} value={o.copyId}>
                    {o.title}
                  </option>
                ))}
              </select>
            </label>
          )}
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
            <Comment
              key={c.id}
              comment={c}
              target={target}
              path={path}
              canComment={canComment && Boolean(viewerId)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

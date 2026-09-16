'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { claimByCodeAction } from './actions'
import type { ClaimOptions } from './queries'
import styles from './ClaimForm.module.css'

/**
 * The ways to say "I have this", and what each of them costs.
 *
 * There are three different acts here and they are deliberately not one button
 * with a dropdown:
 *
 *   storage   — a venue holds the book for its owner. Nothing changes hands,
 *               nobody is owed anything; it is the service that lets two people
 *               swap without meeting.
 *   donation  — a venue is given the book. Ownership moves and the donor earns
 *               one credit, good for any book at any storage point.
 *   handover  — two people, one book, no venue and no credits.
 *
 * Which appear follows from the two accounts involved, worked out by the
 * database (claim_options) because it depends on the other party and on a
 * balance the browser may not read.
 *
 * None of them moves anything on its own: the owner has to agree. That is said
 * on the button rather than in small print, because "авлаа" reads like a
 * completed act and this is a request.
 */
export function ClaimForm({
  code,
  title,
  options,
}: {
  code: string
  title: string
  options: ClaimOptions
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ kind: 'storage' | 'ownership'; copyId: string } | null>(null)
  const [pending, start] = useTransition()

  const { viewerIsPoint, ownerIsPoint, viewerCredits } = options
  const costsCredit = options.ownershipCosts > 0
  const earnsCredit = options.ownershipEarns > 0
  const broke = costsCredit && viewerCredits < options.ownershipCosts

  function claim(kind: 'storage' | 'ownership') {
    setError(null)
    start(async () => {
      const r = await claimByCodeAction(code, kind, note)
      if (!r.ok) setError(r.message)
      else setDone({ kind, copyId: r.copyId })
    })
  }

  if (done) {
    return (
      <div className={styles.done}>
        <h2 className={styles.doneTitle}>Хүсэлт илгээгдлээ</h2>
        <p className={styles.doneBody}>
          «{title}»-ийн эзэмшигчид мэдэгдлээ. Тэр зөвшөөрснөөр{' '}
          {done.kind === 'storage'
            ? 'энэ зүйл таны хадгалах цэгт бүртгэгдэнэ. Эзэмшил хэвээр үлдэнэ.'
            : costsCredit
              ? 'эзэмшил тань руу шилжиж, 1 оноо зарцуулагдана.'
              : earnsCredit
                ? 'эзэмшил тань руу шилжиж, хандивласан хүн 1 оноо авна.'
                : 'эзэмшил тань руу шилжинэ.'}{' '}
          Гурав хоногийн дотор хариу ирэхгүй бол хүсэлт хүчингүй болно.
        </p>
        <Link href={`/books/${done.copyId}`} className={styles.doneLink}>
          Тухайн зүйлийг харах →
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <label className={styles.label} htmlFor="claim-note">
        Тэмдэглэл <span className={styles.optional}>(заавал биш)</span>
      </label>
      <textarea
        id="claim-note"
        className={styles.note}
        rows={2}
        maxLength={500}
        value={note}
        disabled={pending}
        onChange={(e) => setNote(e.target.value)}
        placeholder={viewerIsPoint ? 'Хаана тавьсан, хэзээ авчирсан…' : 'Хаана, хэзээ авсан…'}
      />

      <div className={styles.buttons}>
        {/* Donation leads. It is the act the site is actually asking for — a
            book that changes hands is one somebody else can read — and it is
            the one people misread as "I am just giving my book away", so what
            comes back for it is on the button rather than in a footnote. */}
        <button
          type="button"
          className={styles.primary}
          disabled={pending || broke}
          onClick={() => claim('ownership')}
        >
          <span className={styles.buttonTop}>
            {pending
              ? 'Илгээж байна…'
              : viewerIsPoint
                ? 'Хандив болгон авлаа'
                : ownerIsPoint
                  ? 'Энэ номыг авах'
                  : 'Өөрийн болгон авлаа'}
            {earnsCredit && <span className={styles.reward}>Эзэмшигчид +1 оноо</span>}
            {costsCredit && <span className={styles.cost}>−1 оноо</span>}
          </span>
          <span className={styles.sub}>
            {costsCredit
              ? `Эзэмшил тань руу шилжинэ. Танд ${viewerCredits} оноо байна.`
              : earnsCredit
                ? 'Эзэмшил тань руу шилжинэ. Эзэмшигч нь хариуд нь 1 оноо авах ба түүгээрээ дурын хадгалах цэгээс дурын ном авч болно — зүгээр нэг өгч байгаа хэрэг биш.'
                : 'Эзэмшил тань руу шилжинэ.'}
          </span>
        </button>

        {viewerIsPoint && (
          <button
            type="button"
            className={styles.secondary}
            disabled={pending}
            onClick={() => claim('storage')}
          >
            <span className={styles.buttonTop}>
              {pending ? 'Илгээж байна…' : 'Зөвхөн хадгалж авлаа'}
            </span>
            <span className={styles.sub}>
              Эзэмшил өөрчлөгдөхгүй, оноо ч гарахгүй. Хоёр хүн уулзалгүйгээр солилцоход
              туслах үйлчилгээ.
            </span>
          </button>
        )}
      </div>

      {broke && (
        <p className={styles.blocked}>
          Танд оноо алга. Хадгалах цэгт нэг ном хандивлаад 1 оноо аваарай — тэр онооороо
          дурын хадгалах цэгээс дурын ном авч болно.{' '}
          <Link href="/storage-points">Хадгалах цэгүүд</Link>
        </p>
      )}

      <p className={styles.fineprint}>Эзэмшигч зөвшөөрөх хүртэл юу ч өөрчлөгдөхгүй.</p>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

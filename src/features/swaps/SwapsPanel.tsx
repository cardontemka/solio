import Link from 'next/link'
import { BookCover } from '@/components/BookCard'
import { Badge, EmptyState } from '@/components/ui'
import { SwapActions } from './SwapActions'
import type { SwapItemView, SwapView } from './queries'
import { SWAP_STATUS_LABEL, type SwapStatus } from '@/types/domain'
import styles from './SwapsPanel.module.css'

/**
 * Active and historical swaps for the signed-in user. Shared by /swaps and the
 * /dashboard panel.
 */
const TONE: Record<SwapStatus, 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'> = {
  REQUESTED: 'warn',
  ACCEPTED: 'accent',
  CONFIRMED: 'accent',
  COMPLETED: 'ok',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
}

const STEP: Partial<Record<SwapStatus, number>> = {
  REQUESTED: 0,
  ACCEPTED: 1,
  CONFIRMED: 2,
  COMPLETED: 3,
}

export const ACTIVE_STATUSES: SwapStatus[] = ['REQUESTED', 'ACCEPTED', 'CONFIRMED']

function Items({ items }: { items: SwapItemView[] }) {
  return (
    <>
      {items.map((item) => (
        <Link key={item.copyId} href={`/books/${item.copyId}`} className={styles.bookRow}>
          <BookCover
            title={item.title}
            author={item.author}
            color={item.coverColor}
            src={item.imageUrl}
            size="sm"
          />
          <div>
            <p className={styles.bookTitle}>{item.title}</p>
            {item.author && <p className={styles.bookAuthor}>{item.author}</p>}
          </div>
        </Link>
      ))}
    </>
  )
}

function SwapCard({ swap }: { swap: SwapView }) {
  const step = STEP[swap.status]
  return (
    <article id={`swap-${swap.id}`} className={styles.swap} data-awaiting={swap.awaitingMe}>
      <header className={styles.head}>
        <div className={styles.headLeft}>
          <Badge tone={TONE[swap.status]}>{SWAP_STATUS_LABEL[swap.status]}</Badge>
          <span className={styles.direction}>
            {swap.direction === 'incoming'
              ? `← ${swap.counterpartyName}-с ирсэн`
              : `→ ${swap.counterpartyName} руу илгээсэн`}
          </span>
        </div>
        <span className={styles.date}>{swap.createdAt}</span>
      </header>

      <div className={styles.parties}>
        <div className={styles.side}>
          <p className={styles.sideLabel}>
            {swap.direction === 'outgoing' ? 'Та санал болгосон' : 'Санал болгосон ном'}
          </p>
          <Items items={swap.offered} />
        </div>
        <div className={styles.swapIcon} aria-hidden="true">⇄</div>
        <div className={styles.side}>
          <p className={styles.sideLabel}>
            {swap.direction === 'outgoing' ? 'Таны хүссэн ном' : 'Таны ном'}
          </p>
          <Items items={swap.requested} />
        </div>
      </div>

      {swap.message && <p className={styles.message}>“{swap.message}”</p>}

      {step !== undefined && (
        <ol className={styles.steps}>
          {['Хүсэлт', 'Хүлээн авсан', 'Баталгаажсан', 'Дууссан'].map((label, i) => (
            <li key={label} className={styles.step} data-done={i <= step}>
              <span className={styles.stepDot} />
              {label}
            </li>
          ))}
        </ol>
      )}

      {swap.status === 'ACCEPTED' && (
        <p className={styles.hint}>
          Номоо биечлэн солилцсоны дараа “Гардуулсныг баталгаажуулах” дарна уу. Хоёр тал
          баталгаажуулснаар өмчлөл шилжинэ.
        </p>
      )}
      {swap.status === 'CONFIRMED' && (
        <p className={styles.hint}>
          {swap.iConfirmed
            ? 'Та баталгаажуулсан. Нөгөө талын баталгаажуулалтыг хүлээж байна.'
            : `${swap.counterpartyName} гардуулснаа баталгаажуулсан. Таны баталгаажуулалт солилцоог дуусгана.`}
        </p>
      )}

      <SwapActions
        swapId={swap.id}
        status={swap.status}
        direction={swap.direction}
        iConfirmed={swap.iConfirmed}
      />
    </article>
  )
}

export function SwapsPanel({ swaps }: { swaps: SwapView[] }) {
  const active = swaps.filter((s) => ACTIVE_STATUSES.includes(s.status))
  const history = swaps.filter((s) => !ACTIVE_STATUSES.includes(s.status))

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Идэвхтэй <span className={styles.count}>{active.length}</span>
        </h2>
        {active.length > 0 ? (
          <div className={styles.list}>
            {active.map((s) => <SwapCard key={s.id} swap={s} />)}
          </div>
        ) : (
          <EmptyState
            title="Идэвхтэй солилцоо байхгүй"
            description="Номын хуудас руу орж, солилцоо санал болгож эхлээрэй."
          />
        )}
      </section>

      {history.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Түүх <span className={styles.count}>{history.length}</span>
          </h2>
          <div className={styles.list}>
            {history.map((s) => <SwapCard key={s.id} swap={s} />)}
          </div>
        </section>
      )}
    </>
  )
}

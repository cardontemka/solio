import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BookCover } from '@/components/BookCard'
import { Badge, EmptyState } from '@/components/ui'
import { UserDashboard } from '@/components/UserDashboard'
import type { PanelKey } from '@/components/UserDashboard'
import { CopyVisibilityButton } from '@/features/books/CopyVisibilityButton'
import { getMyCopies } from '@/features/books/queries'
import { RequestActions } from '@/features/wishlist/RequestActions'
import { getMyRequests } from '@/features/wishlist/queries'
import { SwapActions } from '@/features/swaps/SwapActions'
import { getMySwaps } from '@/features/swaps/queries'
import type { SwapItemView, SwapView } from '@/features/swaps/queries'
import { requireUser } from '@/lib/auth/dal'
import {
  CONDITION_LABEL,
  COPY_STATUS_LABEL,
  SWAP_STATUS_LABEL,
  type CopyStatus,
  type SwapStatus,
} from '@/types/domain'
import mbStyles from '@/app/my-books/page.module.css'
import wlStyles from '@/app/wishlist/page.module.css'
import swStyles from '@/app/swaps/page.module.css'

export const metadata = { title: 'Миний хуудас' }

const BOOK_GROUPS: { status: CopyStatus; title: string; desc: string }[] = [
  { status: 'available', title: 'Боломжтой', desc: 'Солилцоонд нээлттэй' },
  { status: 'reserved', title: 'Захиалагдсан', desc: 'Идэвхтэй солилцоонд түгжигдсэн' },
  { status: 'swapped', title: 'Солилцсон', desc: 'Саяхан хүлээн авсан' },
  { status: 'inactive', title: 'Идэвхгүй', desc: 'Түр нуусан номнууд' },
]

const SWAP_TONE: Record<SwapStatus, 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'> = {
  REQUESTED: 'warn',
  ACCEPTED: 'accent',
  CONFIRMED: 'accent',
  COMPLETED: 'ok',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
}

const SWAP_STEP: Partial<Record<SwapStatus, number>> = {
  REQUESTED: 0,
  ACCEPTED: 1,
  CONFIRMED: 2,
  COMPLETED: 3,
}

type Props = { params: Promise<{ username: string }> }

export default async function UserPage({ params }: Props) {
  const { username } = await params
  const me = await requireUser()
  if (me.username !== username) redirect(`/u/${me.username}`)

  const [copies, requests, swaps] = await Promise.all([
    getMyCopies(me.id),
    getMyRequests(),
    getMySwaps(me.id),
  ])

  const active = swaps.filter((s) => ['REQUESTED', 'ACCEPTED', 'CONFIRMED'].includes(s.status))
  const history = swaps.filter((s) => ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(s.status))
  const awaiting = active.filter((s) => s.awaitingMe).length

  const panels: Record<PanelKey, React.ReactNode> = {
    books: <BooksPanel copies={copies} />,
    wishlist: <WishlistPanel requests={requests} />,
    swaps: <SwapsPanel active={active} history={history} awaiting={awaiting} />,
  }

  return (
    <div className="container">
      <UserDashboard
        initialPanel="books"
        panels={panels}
        userInfo={{
          name: me.displayName,
          username: me.username,
          email: me.email,
          city: null,
          phone: null,
        }}
      />
    </div>
  )
}

function BooksPanel({ copies }: { copies: Awaited<ReturnType<typeof getMyCopies>> }) {
  if (copies.length === 0) {
    return (
      <EmptyState
        title="Ном бүртгээгүй байна"
        description="Эхний номоо нэмээд солилцоо эхлүүлээрэй. Баруун доод буланд байрлах + товч дарна уу."
      />
    )
  }
  return (
    <div>
      {BOOK_GROUPS.map((group) => {
        const items = copies.filter((c) => c.copy.status === group.status)
        if (items.length === 0) return null
        return (
          <section key={group.status} className={mbStyles.group}>
            <div className={mbStyles.groupHead}>
              <h2 className={mbStyles.groupTitle}>
                {group.title} <span className={mbStyles.count}>{items.length}</span>
              </h2>
              <p className={mbStyles.groupDesc}>{group.desc}</p>
            </div>
            <ul className={mbStyles.list}>
              {items.map(({ copy, book }) => (
                <li key={copy.id} className={mbStyles.item}>
                  <Link href={`/books/${book.id}`} className={mbStyles.thumb}>
                    <BookCover title={book.title} author={book.author} color={book.coverColor} size="sm" />
                  </Link>
                  <div className={mbStyles.itemBody}>
                    <Link href={`/books/${book.id}`} className={mbStyles.itemTitle}>{book.title}</Link>
                    {book.author && <p className={mbStyles.itemAuthor}>{book.author}</p>}
                    <div className={mbStyles.itemMeta}>
                      <Badge tone="accent">{CONDITION_LABEL[copy.condition]}</Badge>
                      <Badge tone={copy.status === 'available' ? 'ok' : 'neutral'}>
                        {COPY_STATUS_LABEL[copy.status]}
                      </Badge>
                      {copy.transferCount > 0 && <Badge>{copy.transferCount} удаа солигдсон</Badge>}
                      <span className={mbStyles.date}>{copy.createdAt}-нд нэмсэн</span>
                    </div>
                    {copy.conditionNote && <p className={mbStyles.note}>{copy.conditionNote}</p>}
                  </div>
                  {(copy.status === 'available' || copy.status === 'inactive') && (
                    <div className={mbStyles.itemActions}>
                      <CopyVisibilityButton
                        copyId={copy.id}
                        next={copy.status === 'available' ? 'inactive' : 'available'}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function WishlistPanel({ requests }: { requests: Awaited<ReturnType<typeof getMyRequests>> }) {
  const open = requests.filter((r) => r.status === 'open')
  const closed = requests.filter((r) => r.status !== 'open')
  const matched = open.filter((r) => r.matchedBookId).length

  return (
    <div className={wlStyles.layout}>
      <div className={wlStyles.main}>
        <h2 className={wlStyles.groupTitle}>
          Нээлттэй хүсэлт <span className={wlStyles.count}>{open.length}</span>
        </h2>
        {open.length === 0 ? (
          <EmptyState title="Нээлттэй хүсэлт байхгүй" />
        ) : (
          <ul className={wlStyles.list}>
            {open.map((r) => <WishRow key={r.id} r={r} />)}
          </ul>
        )}
        {closed.length > 0 && (
          <>
            <h2 className={`${wlStyles.groupTitle} ${wlStyles.groupTitleSpaced}`}>
              Хаагдсан <span className={wlStyles.count}>{closed.length}</span>
            </h2>
            <ul className={wlStyles.list}>
              {closed.map((r) => <WishRow key={r.id} r={r} />)}
            </ul>
          </>
        )}
      </div>
      {matched > 0 && (
        <aside className={wlStyles.aside}>
          <p className={wlStyles.match}>✓ {matched} хүсэлтэд тохирох ном олдсон.</p>
        </aside>
      )}
    </div>
  )
}

function WishRow({ r }: { r: Awaited<ReturnType<typeof getMyRequests>>[number] }) {
  return (
    <li className={wlStyles.item} data-muted={r.status !== 'open'}>
      <div className={wlStyles.itemBody}>
        <div className={wlStyles.itemHead}>
          {r.linkedBookId ? (
            <Link href={`/books/${r.linkedBookId}`} className={wlStyles.itemTitle}>{r.title}</Link>
          ) : (
            <span className={wlStyles.itemTitle}>{r.title}</span>
          )}
          {r.status === 'cancelled' && <Badge>Цуцалсан</Badge>}
          {r.status === 'fulfilled' && <Badge tone="ok">Биелсэн</Badge>}
          {r.status === 'open' && !r.matchedBookId && <Badge>Хайж байна</Badge>}
          {r.status === 'open' && r.matchedBookId && <Badge tone="ok">Олдсон</Badge>}
        </div>
        {r.author && <p className={wlStyles.itemAuthor}>{r.author}</p>}
        {r.isbn && <p className={wlStyles.isbn}>ISBN {r.isbn}</p>}
        {r.note && <p className={wlStyles.note}>{r.note}</p>}
        {r.matchedBookId && (
          <p className={wlStyles.match}>
            ✓ Тохирох ном системд нэмэгдсэн:{' '}
            <Link href={`/books/${r.matchedBookId}`}>{r.matchedTitle ?? 'номыг үзэх'}</Link>
          </p>
        )}
        <p className={wlStyles.date}>{r.createdAt}-нд нэмсэн</p>
      </div>
      <RequestActions id={r.id} status={r.status} />
    </li>
  )
}

function SwapsPanel({
  active,
  history,
  awaiting,
}: {
  active: SwapView[]
  history: SwapView[]
  awaiting: number
}) {
  return (
    <div>
      {awaiting > 0 && (
        <p className={swStyles.hint}>
          {awaiting} солилцоо таны хариуг хүлээж байна.
        </p>
      )}
      <section className={swStyles.section}>
        <h2 className={swStyles.sectionTitle}>
          Идэвхтэй <span className={swStyles.count}>{active.length}</span>
        </h2>
        {active.length > 0 ? (
          <div className={swStyles.list}>
            {active.map((s) => <SwapCard key={s.id} swap={s} />)}
          </div>
        ) : (
          <EmptyState title="Идэвхтэй солилцоо байхгүй" description="Номын хуудас руу орж, солилцоо санал болгож эхлээрэй." />
        )}
      </section>
      {history.length > 0 && (
        <section className={swStyles.section}>
          <h2 className={swStyles.sectionTitle}>
            Түүх <span className={swStyles.count}>{history.length}</span>
          </h2>
          <div className={swStyles.list}>
            {history.map((s) => <SwapCard key={s.id} swap={s} />)}
          </div>
        </section>
      )}
    </div>
  )
}

function SwapItems({ items }: { items: SwapItemView[] }) {
  return (
    <>
      {items.map((item) => (
        <Link key={item.copyId} href={`/books/${item.bookId}`} className={swStyles.bookRow}>
          <BookCover title={item.title} author={item.author} color={item.coverColor} size="sm" />
          <div>
            <p className={swStyles.bookTitle}>{item.title}</p>
            {item.author && <p className={swStyles.bookAuthor}>{item.author}</p>}
          </div>
        </Link>
      ))}
    </>
  )
}

function SwapCard({ swap }: { swap: SwapView }) {
  const step = SWAP_STEP[swap.status]
  return (
    <article className={swStyles.swap} data-awaiting={swap.awaitingMe}>
      <header className={swStyles.head}>
        <div className={swStyles.headLeft}>
          <Badge tone={SWAP_TONE[swap.status]}>{SWAP_STATUS_LABEL[swap.status]}</Badge>
          <span className={swStyles.direction}>
            {swap.direction === 'incoming'
              ? `← ${swap.counterpartyName}-с ирсэн`
              : `→ ${swap.counterpartyName} руу илгээсэн`}
          </span>
        </div>
        <span className={swStyles.date}>{swap.createdAt}</span>
      </header>

      <div className={swStyles.parties}>
        <div className={swStyles.side}>
          <p className={swStyles.sideLabel}>
            {swap.direction === 'outgoing' ? 'Та санал болгосон' : 'Санал болгосон ном'}
          </p>
          <SwapItems items={swap.offered} />
        </div>
        <div className={swStyles.swapIcon} aria-hidden="true">⇄</div>
        <div className={swStyles.side}>
          <p className={swStyles.sideLabel}>
            {swap.direction === 'outgoing' ? 'Таны хүссэн ном' : 'Таны ном'}
          </p>
          <SwapItems items={swap.requested} />
        </div>
      </div>

      {swap.message && <p className={swStyles.message}>“{swap.message}”</p>}

      {step !== undefined && (
        <ol className={swStyles.steps}>
          {['Хүсэлт', 'Хүлээн авсан', 'Баталгаажсан', 'Дууссан'].map((label, i) => (
            <li key={label} className={swStyles.step} data-done={i <= step}>
              <span className={swStyles.stepDot} />
              {label}
            </li>
          ))}
        </ol>
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

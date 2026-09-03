import { EmptyState } from '@/components/ui'
import { AddRequestForm } from './AddRequestForm'
import { RequestActions } from './RequestActions'
import { RequestCard } from './RequestCard'
import type { RequestView } from './queries'
import styles from './MyRequestsPanel.module.css'

/**
 * The viewer's own posts, with the controls only they get. Shared by /dashboard
 * and by the requests page's "мой" column.
 */
export function MyRequestsPanel({ requests }: { requests: RequestView[] }) {
  const open = requests.filter((r) => r.status === 'open')
  const closed = requests.filter((r) => r.status !== 'open')

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <h2 className={styles.groupTitle}>
          Хайж байгаа <span className={styles.count}>{open.length}</span>
        </h2>

        {open.length === 0 ? (
          <EmptyState
            title="Хүсэлт нийтлээгүй байна"
            description="Хажуугийн формоор хайж буй номоо нийтэлнэ үү — бусад хүн доор нь хариу бичнэ."
          />
        ) : (
          <ul className={styles.list}>
            {open.map((r) => (
              <li key={r.id} className={styles.row}>
                <RequestCard request={r} />
                <RequestActions id={r.id} status={r.status} />
              </li>
            ))}
          </ul>
        )}

        {closed.length > 0 && (
          <>
            <h2 className={`${styles.groupTitle} ${styles.groupTitleSpaced}`}>
              Хаагдсан <span className={styles.count}>{closed.length}</span>
            </h2>
            <ul className={styles.list}>
              {closed.map((r) => (
                <li key={r.id} className={styles.row}>
                  <RequestCard request={r} />
                  <RequestActions id={r.id} status={r.status} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <aside className={styles.aside}>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Ном хүсэх</h3>
          <p className={styles.cardDesc}>
            Хайж буй номоо нийтэлнэ. Тухайн ном байгаа хүмүүс доор нь хариу бичих боломжтой.
          </p>
          <AddRequestForm />
        </div>
      </aside>
    </div>
  )
}

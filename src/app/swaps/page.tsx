import { PageHeader } from '@/components/ui'
import { ACTIVE_STATUSES, SwapsPanel } from '@/features/swaps/SwapsPanel'
import { getMySwaps } from '@/features/swaps/queries'
import { requireUser } from '@/lib/auth/dal'

export const metadata = {
  title: 'Солилцоо',
  robots: { index: false, follow: false },
}

export default async function SwapsPage() {
  const me = await requireUser()
  const swaps = await getMySwaps(me.id)
  const awaiting = swaps.filter((s) => ACTIVE_STATUSES.includes(s.status) && s.awaitingMe).length

  return (
    <div className="container">
      <PageHeader
        title="Солилцоо"
        subtitle={
          awaiting > 0
            ? `${awaiting} солилцоо таны хариуг хүлээж байна.`
            : 'Илгээсэн болон хүлээн авсан солилцооны хүсэлтүүд.'
        }
      />
      <SwapsPanel swaps={swaps} />
    </div>
  )
}

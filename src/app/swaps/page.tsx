import { PageHeader } from '@/components/ui'
import { Pager } from '@/components/Pager'
import { ACTIVE_STATUSES, SwapsPanel } from '@/features/swaps/SwapsPanel'
import { getMySwaps } from '@/features/swaps/queries'
import { requireUser } from '@/lib/auth/dal'
import { pageFrom, splitPage } from '@/lib/paging'

export const metadata = {
  title: 'Солилцоо',
  robots: { index: false, follow: false },
}

const PER_PAGE = 20

export default async function SwapsPage({ searchParams }: PageProps<'/swaps'>) {
  const me = await requireUser()
  const params = await searchParams
  const info = pageFrom(params, PER_PAGE)
  const { items: swaps, hasMore } = splitPage(
    await getMySwaps(me.id, { limit: info.fetch, offset: info.offset }),
    info
  )
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
      <Pager page={info.page} hasMore={hasMore} params={params} basePath="/swaps" />
    </div>
  )
}

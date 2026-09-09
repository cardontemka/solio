import { ButtonLink, PageHeader } from '@/components/ui'
import { Pager } from '@/components/Pager'
import { MyBooksPanel } from '@/features/books/MyBooksPanel'
import { getMyCopies } from '@/features/books/queries'
import { requireUser } from '@/lib/auth/dal'
import { pageFrom, splitPage } from '@/lib/paging'

export const metadata = {
  title: 'Миний номнууд',
  robots: { index: false, follow: false },
}

const PER_PAGE = 24

export default async function MyBooksPage({ searchParams }: PageProps<'/my-books'>) {
  const me = await requireUser()
  const params = await searchParams
  const info = pageFrom(params, PER_PAGE)
  const { items: copies, hasMore } = splitPage(
    await getMyCopies(me.id, { limit: info.fetch, offset: info.offset }),
    info
  )

  return (
    <div className="container">
      <PageHeader
        title="Миний номнууд"
        subtitle="Номоо нэмэх, түр нуух боломжтой."
        action={<ButtonLink href="/books/new">Ном нэмэх</ButtonLink>}
      />
      <MyBooksPanel
        copies={copies}
        emptyAction={<ButtonLink href="/books/new">Ном нэмэх</ButtonLink>}
      />
      <Pager page={info.page} hasMore={hasMore} params={params} basePath="/my-books" />
    </div>
  )
}

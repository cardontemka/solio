import { ButtonLink, PageHeader } from '@/components/ui'
import { MyBooksPanel } from '@/features/books/MyBooksPanel'
import { getMyCopies } from '@/features/books/queries'
import { requireUser } from '@/lib/auth/dal'

export const metadata = {
  title: 'Миний номнууд',
  robots: { index: false, follow: false },
}

export default async function MyBooksPage() {
  const me = await requireUser()
  const copies = await getMyCopies(me.id)

  return (
    <div className="container">
      <PageHeader
        title="Миний номнууд"
        subtitle={`${copies.length} ном бүртгэлтэй. Номоо нэмэх, түр нуух боломжтой.`}
        action={<ButtonLink href="/books/new">Ном нэмэх</ButtonLink>}
      />
      <MyBooksPanel
        copies={copies}
        emptyAction={<ButtonLink href="/books/new">Ном нэмэх</ButtonLink>}
      />
    </div>
  )
}

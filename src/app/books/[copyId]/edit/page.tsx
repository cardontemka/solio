import { notFound, redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui'
import { EditListingForm } from '@/features/books/EditListingForm'
import { getListing } from '@/features/books/queries'
import { requireUser } from '@/lib/auth/dal'
import styles from '@/app/books/new/page.module.css'

export const metadata = {
  title: 'Ном засварлах',
  robots: { index: false, follow: false },
}

export default async function EditListingPage({ params }: PageProps<'/books/[copyId]/edit'>) {
  const { copyId } = await params
  const me = await requireUser()
  const listing = await getListing(copyId)
  if (!listing) notFound()
  // The RPC checks this again; this only avoids rendering a form that could
  // never be saved.
  if (listing.owner?.id !== me.id) redirect(`/books/${copyId}`)

  return (
    <div className="container">
      <div className={styles.shell}>
        <PageHeader
          title="Ном засварлах"
          subtitle="Зургийг номынхоо хуудаснаас нэмж, хасна."
        />
        <EditListingForm
          listing={{
            copyId: listing.copyId,
            title: listing.title,
            author: listing.author,
            isbn: listing.isbn,
            publisher: listing.publisher,
            language: listing.language,
            publishedYear: listing.publishedAt ? Number(listing.publishedAt.slice(0, 4)) : null,
            description: listing.description,
            kind: listing.kind,
            categories: listing.categories,
            attributes: listing.attributes,
            weightG: listing.weightG,
            sizeNote: listing.sizeNote,
            condition: listing.condition,
            conditionNote: listing.conditionNote,
          }}
        />
      </div>
    </div>
  )
}

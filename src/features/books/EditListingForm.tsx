'use client'

import { useActionState } from 'react'
import { FieldError, FormMessage } from '@/components/FormError'
import {
  ATTRIBUTES_FOR,
  BOOK_CONDITION,
  CONDITION_LABEL,
  KIND_COPY,
  type BookCategory,
  type BookCondition,
  type ItemKind,
} from '@/types/domain'
import { CategoryPicker } from './CategoryPicker'
import { updateListingAction, type ActionState } from './actions'
import formStyles from '@/components/forms.module.css'
import styles from './AddBookForm.module.css'

const initial: ActionState = { ok: false }

export type ListingDraft = {
  copyId: string
  title: string
  author: string | null
  isbn: string | null
  publisher: string | null
  language: string | null
  publishedYear: number | null
  description: string | null
  kind: ItemKind
  categories: BookCategory[]
  attributes: Record<string, string | number>
  weightG: number | null
  sizeNote: string | null
  condition: BookCondition
  conditionNote: string | null
}

/**
 * The same fields as adding a book, minus the photos — those are managed on
 * the listing itself, where they are visible while you work on them.
 *
 * Uncontrolled with defaultValue: unlike the auth forms there is nothing to
 * lose on a rejection, because every field is already filled from the row. On
 * success the action redirects, so there is no success branch to render.
 */
export function EditListingForm({ listing }: { listing: ListingDraft }) {
  // The kind is fixed once a listing exists: changing it would strand the fields
  // of the kind it used to be, and re-listing is the honest way to say "this is
  // a different thing".
  const kind = listing.kind
  const words = KIND_COPY[kind]
  const action = updateListingAction.bind(null, listing.copyId)
  const [state, formAction, pending] = useActionState(action, initial)
  const errors = !state.ok ? state.errors : undefined

  return (
    <form action={formAction} className={styles.form}>
      {!state.ok && <FormMessage message={state.message} />}

      <fieldset className={styles.group} disabled={pending}>
        <legend className={styles.legend}>Номын мэдээлэл</legend>

        <div className={formStyles.field}>
          <input type="hidden" name="kind" value={kind} />
          <label className={formStyles.label} htmlFor="title">
            {words.title}
          </label>
          <input
            className={formStyles.input}
            id="title"
            name="title"
            type="text"
            required
            maxLength={300}
            defaultValue={listing.title}
          />
          <FieldError errors={errors?.title} />
        </div>

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="author">
              {words.author}
            </label>
            <input
              className={formStyles.input}
              id="author"
              name="author"
              type="text"
              maxLength={200}
              defaultValue={listing.author ?? ''}
            />
            <FieldError errors={errors?.author} />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="publisher">
              {words.publisher}
              <span className={formStyles.optional}>заавал биш</span>
            </label>
            <input
              className={formStyles.input}
              id="publisher"
              name="publisher"
              type="text"
              maxLength={200}
              defaultValue={listing.publisher ?? ''}
            />
          </div>
        </div>

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="language">
              Хэл
            </label>
            <select
              className={formStyles.select}
              id="language"
              name="language"
              defaultValue={listing.language ?? 'other'}
            >
              <option value="mn">Монгол</option>
              <option value="en">Англи</option>
              <option value="ru">Орос</option>
              <option value="other">Бусад</option>
            </select>
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="publishedYear">
              Хэвлэсэн он
              <span className={formStyles.optional}>заавал биш</span>
            </label>
            <input
              className={formStyles.input}
              id="publishedYear"
              name="publishedYear"
              type="number"
              min={1000}
              max={2027}
              defaultValue={listing.publishedYear ?? ''}
            />
            <FieldError errors={errors?.publishedYear} />
          </div>
        </div>

        {kind === 'book' && (
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="isbn">
              ISBN
              <span className={formStyles.optional}>заавал биш</span>
            </label>
            <input
              className={formStyles.input}
              id="isbn"
              name="isbn"
              type="text"
              inputMode="numeric"
              defaultValue={listing.isbn ?? ''}
            />
            <FieldError errors={errors?.isbn} />
          </div>
        )}


        <div className={formStyles.field}>
          <span className={formStyles.label}>
            Ангилал
            <span className={formStyles.optional}>заавал биш</span>
          </span>
          <CategoryPicker kind={kind} initial={listing.categories} />
          <FieldError errors={errors?.categories} />
        </div>

        {/* Rendered from ATTRIBUTES_FOR, like the add form: one list, one place
            to add a field when a new kind arrives. */}
        {ATTRIBUTES_FOR[kind].length > 0 && (
          <div className={formStyles.row}>
            {ATTRIBUTES_FOR[kind].map((field) => (
              <div key={field.key} className={formStyles.field}>
                <label className={formStyles.label} htmlFor={field.key}>
                  {field.label}
                  <span className={formStyles.optional}>заавал биш</span>
                </label>
                {field.type === 'enum' ? (
                  <select
                    className={formStyles.select}
                    id={field.key}
                    name={field.key}
                    defaultValue={String(listing.attributes[field.key] ?? '')}
                  >
                    <option value="">— сонгоогүй —</option>
                    {field.options?.map((o) => (
                      <option key={o} value={String(o)}>
                        {o}
                        {field.suffix ?? ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={formStyles.input}
                    id={field.key}
                    name={field.key}
                    type={field.type === 'int' ? 'number' : 'text'}
                    min={field.min}
                    max={field.max}
                    inputMode={field.type === 'int' ? 'numeric' : undefined}
                    placeholder={field.placeholder}
                    defaultValue={String(listing.attributes[field.key] ?? '')}
                  />
                )}
                <FieldError errors={errors?.[field.key]} />
              </div>
            ))}
          </div>
        )}

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="weightG">
              Жин (грамм)
              <span className={formStyles.optional}>заавал биш</span>
            </label>
            <input
              className={formStyles.input}
              id="weightG"
              name="weightG"
              type="number"
              min={1}
              max={20000}
              inputMode="numeric"
              placeholder="450"
              defaultValue={listing.weightG ?? ''}
            />
            <FieldError errors={errors?.weightG} />
          </div>
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="sizeNote">
            Хэмжээ
            <span className={formStyles.optional}>заавал биш</span>
          </label>
          <input
            className={formStyles.input}
            id="sizeNote"
            name="sizeNote"
            type="text"
            maxLength={40}
            placeholder="14×20 см"
            defaultValue={listing.sizeNote ?? ''}
          />
          <FieldError errors={errors?.sizeNote} />
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="description">
            Тайлбар
            <span className={formStyles.optional}>заавал биш</span>
          </label>
          <textarea
            className={formStyles.textarea}
            id="description"
            name="description"
            maxLength={8000}
            defaultValue={listing.description ?? ''}
          />
          <FieldError errors={errors?.description} />
        </div>
      </fieldset>

      <fieldset className={styles.group} disabled={pending}>
        <legend className={styles.legend}>Таны хувийн нөхцөл</legend>

        <div className={styles.conditions}>
          {BOOK_CONDITION.map((c) => (
            <label key={c} className={styles.condition}>
              <input
                type="radio"
                name="condition"
                value={c}
                defaultChecked={c === listing.condition}
              />
              <span>{CONDITION_LABEL[c]}</span>
            </label>
          ))}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="conditionNote">
            Нөхцөлийн тайлбар
            <span className={formStyles.optional}>заавал биш</span>
          </label>
          <textarea
            className={formStyles.textarea}
            id="conditionNote"
            name="conditionNote"
            maxLength={1000}
            defaultValue={listing.conditionNote ?? ''}
          />
          <FieldError errors={errors?.conditionNote} />
        </div>
      </fieldset>

      <div className={styles.actions}>
        <button className={formStyles.submit} type="submit" disabled={pending}>
          {pending ? 'Хадгалж байна…' : 'Хадгалах'}
        </button>
      </div>
    </form>
  )
}

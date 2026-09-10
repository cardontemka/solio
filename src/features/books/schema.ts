import { z } from 'zod'
import type { BookCategory } from '@/types/domain'
import {
  ATTRIBUTES_FOR,
  BOOK_CATEGORY,
  BOOK_CATEGORY_MAX,
  BOOK_CONDITION,
  ITEM_KIND,
  VINYL_CATEGORY,
} from '@/types/domain'

const KNOWN_CATEGORY = new Set<string>([...BOOK_CATEGORY, ...VINYL_CATEGORY])

/**
 * Validation shared by the client form and the Server Action. The action
 * re-parses on the server: client validation is a convenience, never a check.
 */
export const createBookSchema = z.object({
  /** Book or record. Decides which fields below mean anything. */
  kind: z.enum(ITEM_KIND).default('book'),
  title: z
    .string()
    .trim()
    .min(1, 'Номын нэрийг оруулна уу.')
    .max(300, 'Номын нэр хэт урт байна.'),
  author: z.string().trim().max(200, 'Зохиогчийн нэр хэт урт байна.').optional(),
  isbn: z
    .string()
    .trim()
    .max(32)
    .refine((v) => v === '' || /^[0-9Xx\- ]+$/.test(v), 'ISBN нь зөвхөн тоо, зураас байна.')
    .optional(),
  publisher: z.string().trim().max(200).optional(),
  language: z.enum(['mn', 'en', 'ru', 'other']).optional(),
  description: z.string().trim().max(8000, 'Тайлбар хэт урт байна.').optional(),
  publishedYear: z
    .union([z.literal(''), z.coerce.number().int().min(1000).max(2027)])
    .optional(),
  /**
   * Several headings per book. Unknown values are dropped rather than refused:
   * the picker only ever sends known ones, so a stray value means a stale tab,
   * and failing the whole form over it would lose everything else that was typed.
   */
  categories: z
    .array(z.string())
    .transform((v) => [...new Set(v.filter((c): c is BookCategory => KNOWN_CATEGORY.has(c)))])
    .refine(
      (v) => v.length <= BOOK_CATEGORY_MAX,
      `Хамгийн ихдээ ${BOOK_CATEGORY_MAX} ангилал сонгоно.`
    ),
  /**
   * The catalogue row the reader picked from "энэ ном биш биз?". The database
   * treats it as a hint and ignores it unless the rest of the submission still
   * describes that book, so a forged id cannot attach a listing to a row it does
   * not match.
   */
  bookId: z.union([z.literal(''), z.guid()]).optional(),
  weightG: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(20000)])
    .optional(),
  sizeNote: z.string().trim().max(40, 'Хэмжээ хэт урт байна.').optional(),
  condition: z.enum(BOOK_CONDITION),
  conditionNote: z.string().trim().max(1000, 'Тайлбар хэт урт байна.').optional(),
})

export type CreateBookInput = z.infer<typeof createBookSchema>

/**
 * Pulls the kind's own fields out of the submitted form into the jsonb object
 * the RPC takes. Blank boxes are left out rather than sent as empty strings —
 * an absent key is how "not filled in" is spelt in the column.
 *
 * No validation here beyond dropping blanks: the database owns the spec, checks
 * the ranges, coerces the types and throws away anything it does not recognise.
 * Repeating those rules on this side would be two places to keep in step.
 */
export function attributesFrom(kind: string, formData: FormData): Record<string, string> {
  const spec = ATTRIBUTES_FOR[kind as keyof typeof ATTRIBUTES_FOR] ?? []
  const out: Record<string, string> = {}
  for (const field of spec) {
    const raw = formData.get(field.key)
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value) out[field.key] = value
  }
  return out
}

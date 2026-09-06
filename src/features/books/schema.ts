import { z } from 'zod'
import { BOOK_CATEGORY, BOOK_CONDITION } from '@/types/domain'

/**
 * Validation shared by the client form and the Server Action. The action
 * re-parses on the server: client validation is a convenience, never a check.
 */
export const createBookSchema = z.object({
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
  category: z.union([z.literal(''), z.enum(BOOK_CATEGORY)]).optional(),
  pageCount: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(20000)])
    .optional(),
  weightG: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(20000)])
    .optional(),
  sizeNote: z.string().trim().max(40, 'Хэмжээ хэт урт байна.').optional(),
  condition: z.enum(BOOK_CONDITION),
  conditionNote: z.string().trim().max(1000, 'Тайлбар хэт урт байна.').optional(),
})

export type CreateBookInput = z.infer<typeof createBookSchema>

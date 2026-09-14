import { z } from 'zod'
import { STORAGE_POINT_KIND } from '@/types/domain'

/**
 * What a place has to tell people before it can hold their books.
 *
 * Everything on the top half is required, and that is the point of the feature:
 * a storage point whose address, hours or telephone are missing is not a
 * storage point, it is a name. The bottom half genuinely does not stop anybody
 * finding the door, so it is optional.
 *
 * Shared by the signup form and the settings form, and re-parsed on the server
 * in both cases — the database repeats every one of these rules as a CHECK, so
 * this exists to say which box is wrong, not to be the thing that stops bad
 * data.
 */
export const storagePointSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Байгууллагынхаа нэрийг бичнэ үү.')
    .max(120, 'Нэр 120 тэмдэгтээс их байж болохгүй.'),
  kind: z.enum(STORAGE_POINT_KIND).default('cafe'),
  city: z
    .string()
    .trim()
    .min(2, 'Хот, аймгаа бичнэ үү.')
    .max(60, 'Хотын нэр хэт урт байна.'),
  district: z
    .string()
    .trim()
    .min(2, 'Дүүрэг, сумаа бичнэ үү.')
    .max(60, 'Дүүргийн нэр хэт урт байна.'),
  address: z
    .string()
    .trim()
    .min(4, 'Дэлгэрэнгүй хаягаа бичнэ үү — хороо, гудамж, байр.')
    .max(300, 'Хаяг 300 тэмдэгтээс их байж болохгүй.'),
  landmark: z.string().trim().max(200, 'Заавар хэт урт байна.').optional(),
  phone: z
    .string()
    .trim()
    .regex(
      /^[0-9+()\-\s]{6,20}$/,
      'Утасны дугаар 6–20 тэмдэгт, зөвхөн тоо, +, зураас байна.'
    ),
  hours: z
    .string()
    .trim()
    .min(2, 'Ажиллах цагаа бичнэ үү.')
    .max(200, 'Ажиллах цагийн тайлбар хэт урт байна.'),
  capacity: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(100000)])
    .optional(),
  website: z
    .string()
    .trim()
    .max(300, 'Холбоос хэт урт байна.')
    .refine(
      (v) => v === '' || /^https?:\/\/\S+$/.test(v),
      'Холбоос http:// эсвэл https:// -ээр эхэлнэ.'
    )
    .optional(),
  description: z.string().trim().max(2000, 'Тайлбар 2000 тэмдэгтээс их байж болохгүй.').optional(),
})

export type StoragePointInput = z.infer<typeof storagePointSchema>

/** Reads the premises out of a submitted form, wherever that form lives. */
export function storagePointFrom(formData: FormData) {
  return storagePointSchema.safeParse({
    name: formData.get('sp_name') ?? '',
    kind: formData.get('sp_kind') ?? 'cafe',
    city: formData.get('sp_city') ?? '',
    district: formData.get('sp_district') ?? '',
    address: formData.get('sp_address') ?? '',
    landmark: formData.get('sp_landmark') ?? '',
    phone: formData.get('sp_phone') ?? '',
    hours: formData.get('sp_hours') ?? '',
    capacity: formData.get('sp_capacity') ?? '',
    website: formData.get('sp_website') ?? '',
    description: formData.get('sp_description') ?? '',
  })
}

/** The same fields as the signup metadata the database trigger reads. */
export function storagePointMetadata(v: StoragePointInput): Record<string, string> {
  return {
    sp_name: v.name,
    sp_kind: v.kind,
    sp_city: v.city,
    sp_district: v.district,
    sp_address: v.address,
    sp_landmark: v.landmark ?? '',
    sp_phone: v.phone,
    sp_hours: v.hours,
    sp_capacity: typeof v.capacity === 'number' ? String(v.capacity) : '',
    sp_website: v.website ?? '',
    sp_description: v.description ?? '',
  }
}

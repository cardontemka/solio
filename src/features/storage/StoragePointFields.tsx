'use client'

import { useState } from 'react'
import { FieldError } from '@/components/FormError'
import { STORAGE_POINT_KIND, STORAGE_POINT_KIND_LABEL } from '@/types/domain'
import type { StoragePoint } from '@/types/domain'
import styles from '@/components/forms.module.css'

/**
 * The premises, as a block of boxes.
 *
 * One component for both the signup form and the settings form, because the
 * two ask for exactly the same things and a venue that filled a box in at
 * signup should find the same box, named the same way, when it comes to change
 * it. The names carry the `sp_` prefix the schema and the signup metadata both
 * read, so neither caller has to know the field list.
 *
 * Controlled, for the same reason the rest of the signup form is: React clears
 * an uncontrolled form once its action returns, and eleven boxes of address is
 * the worst possible thing to make somebody retype because their password was
 * too short.
 */
export function StoragePointFields({
  point,
  errors,
  disabled = false,
}: {
  point?: StoragePoint | null
  errors?: Record<string, string[]>
  disabled?: boolean
}) {
  const [v, setV] = useState({
    name: point?.name ?? '',
    kind: point?.kind ?? 'cafe',
    city: point?.city ?? 'Улаанбаатар',
    district: point?.district ?? '',
    address: point?.address ?? '',
    landmark: point?.landmark ?? '',
    phone: point?.phone ?? '',
    capacity: point?.capacity == null ? '' : String(point.capacity),
    hours: point?.hours ?? '',
    website: point?.website ?? '',
    description: point?.description ?? '',
  })
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((prev) => ({ ...prev, [key]: e.target.value }))

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="sp_name">
          Байгууллагын нэр
        </label>
        <input
          className={styles.input}
          id="sp_name"
          name="sp_name"
          type="text"
          required
          maxLength={120}
          disabled={disabled}
          value={v.name}
          onChange={set('name')}
          placeholder="Жишээ: Номын Кафе"
          aria-invalid={Boolean(errors?.sp_name)}
        />
        <FieldError errors={errors?.sp_name} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sp_kind">
          Төрөл
        </label>
        <select
          className={styles.select}
          id="sp_kind"
          name="sp_kind"
          value={v.kind}
          onChange={set('kind')}
          disabled={disabled}
        >
          {STORAGE_POINT_KIND.map((k) => (
            <option key={k} value={k}>
              {STORAGE_POINT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="sp_city">
            Хот / аймаг
          </label>
          <input
            className={styles.input}
            id="sp_city"
            name="sp_city"
            type="text"
            required
            maxLength={60}
            disabled={disabled}
            value={v.city}
          onChange={set('city')}
            aria-invalid={Boolean(errors?.sp_city)}
          />
          <FieldError errors={errors?.sp_city} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="sp_district">
            Дүүрэг / сум
          </label>
          <input
            className={styles.input}
            id="sp_district"
            name="sp_district"
            type="text"
            required
            maxLength={60}
            disabled={disabled}
            value={v.district}
          onChange={set('district')}
            placeholder="Сүхбаатар дүүрэг"
            aria-invalid={Boolean(errors?.sp_district)}
          />
          <FieldError errors={errors?.sp_district} />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sp_address">
          Дэлгэрэнгүй хаяг
        </label>
        <input
          className={styles.input}
          id="sp_address"
          name="sp_address"
          type="text"
          required
          maxLength={300}
          disabled={disabled}
          value={v.address}
          onChange={set('address')}
          placeholder="1-р хороо, Сеулын гудамж 12, Оргил төв, 1 давхар"
          aria-invalid={Boolean(errors?.sp_address)}
        />
        <span className={styles.hint}>Хороо, гудамж, байр, давхар — очих хүн олох хэмжээнд.</span>
        <FieldError errors={errors?.sp_address} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sp_landmark">
          Чиглүүлэг <span className={styles.optional}>(заавал биш)</span>
        </label>
        <input
          className={styles.input}
          id="sp_landmark"
          name="sp_landmark"
          type="text"
          maxLength={200}
          disabled={disabled}
          value={v.landmark}
          onChange={set('landmark')}
          placeholder="Улсын номын сангийн урд талд"
          aria-invalid={Boolean(errors?.sp_landmark)}
        />
        <FieldError errors={errors?.sp_landmark} />
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="sp_phone">
            Утас
          </label>
          <input
            className={styles.input}
            id="sp_phone"
            name="sp_phone"
            type="tel"
            required
            maxLength={20}
            disabled={disabled}
            value={v.phone}
          onChange={set('phone')}
            placeholder="9911 2233"
            aria-invalid={Boolean(errors?.sp_phone)}
          />
          <FieldError errors={errors?.sp_phone} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="sp_capacity">
            Багтаамж <span className={styles.optional}>(заавал биш)</span>
          </label>
          <input
            className={styles.input}
            id="sp_capacity"
            name="sp_capacity"
            type="number"
            min={1}
            max={100000}
            disabled={disabled}
            value={v.capacity}
          onChange={set('capacity')}
            placeholder="100"
            aria-invalid={Boolean(errors?.sp_capacity)}
          />
          <span className={styles.hint}>Нэг дор хэдэн ном багтаах вэ.</span>
          <FieldError errors={errors?.sp_capacity} />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sp_hours">
          Ажиллах цаг
        </label>
        <input
          className={styles.input}
          id="sp_hours"
          name="sp_hours"
          type="text"
          required
          maxLength={200}
          disabled={disabled}
          value={v.hours}
          onChange={set('hours')}
          placeholder="Даваа–Баасан 09:00–20:00, Бямба 10:00–18:00"
          aria-invalid={Boolean(errors?.sp_hours)}
        />
        <FieldError errors={errors?.sp_hours} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sp_website">
          Цахим хуудас / Facebook <span className={styles.optional}>(заавал биш)</span>
        </label>
        <input
          className={styles.input}
          id="sp_website"
          name="sp_website"
          type="url"
          maxLength={300}
          disabled={disabled}
          value={v.website}
          onChange={set('website')}
          placeholder="https://facebook.com/…"
          aria-invalid={Boolean(errors?.sp_website)}
        />
        <FieldError errors={errors?.sp_website} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sp_description">
          Танилцуулга <span className={styles.optional}>(заавал биш)</span>
        </label>
        <textarea
          className={styles.textarea}
          id="sp_description"
          name="sp_description"
          rows={3}
          maxLength={2000}
          disabled={disabled}
          value={v.description}
          onChange={set('description')}
          placeholder="Ном хадгалах нөхцөл, тавиур хаана байгаа, юу анхаарах вэ."
          aria-invalid={Boolean(errors?.sp_description)}
        />
        <FieldError errors={errors?.sp_description} />
      </div>
    </>
  )
}

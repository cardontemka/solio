'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { MAX_BYTES, MAX_DIMENSION, MIN_BYTES, MIN_DIMENSION } from '@/lib/storage/ports'
import { readDimensions, sniffMime } from '@/lib/storage/verify'
import { toUserMessage } from '@/lib/db/errors'

export type ImageState = { ok: true } | { ok: false; message: string }

const idSchema = z.guid()

/**
 * Verifies the uploaded bytes and publishes the image.
 *
 * This is where a declared MIME type stops being taken on trust: the object's
 * head is read back from storage, sniffed, and its real dimensions parsed. A
 * mismatch removes the object rather than publishing it — otherwise arbitrary
 * bytes with an image extension would be served from the image CDN.
 */
export async function confirmImageAction(imageId: string): Promise<ImageState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }
  if (!idSchema.safeParse(imageId).success) return { ok: false, message: 'Буруу хүсэлт.' }

  const { data: image } = await supabase
    .from('book_images')
    .select('id, storage_key, mime_type, book_copy_id, status')
    .eq('id', imageId)
    .maybeSingle()

  if (!image || image.status !== 'pending') {
    return { ok: false, message: 'Зураг олдсонгүй.' }
  }

  const storage = bookImageStorage()
  const fail = async (message: string): Promise<ImageState> => {
    await supabase.from('book_images').update({ status: 'removed' }).eq('id', imageId)
    await storage.delete(image.storage_key).catch(() => {})
    return { ok: false, message }
  }

  const info = await storage.stat(image.storage_key)
  if (!info) return fail('Зураг байршуулагдаагүй байна.')
  if (info.byteSize < MIN_BYTES || info.byteSize > MAX_BYTES) {
    return fail('Зургийн хэмжээ хэтэрсэн байна.')
  }

  // 64 KiB is enough to reach a JPEG's SOF marker; PNG and WebP need far less.
  const head = await storage.readHead(image.storage_key, 65536)
  if (!head) return fail('Зургийг уншиж чадсангүй.')

  const actualMime = sniffMime(head)
  if (!actualMime || actualMime !== image.mime_type) {
    return fail('Файл зургийн бүтэцтэй тохирохгүй байна.')
  }

  const dims = readDimensions(head, actualMime)
  if (!dims) return fail('Зургийн хэмжээсийг тодорхойлж чадсангүй.')
  if (
    dims.width < MIN_DIMENSION || dims.width > MAX_DIMENSION ||
    dims.height < MIN_DIMENSION || dims.height > MAX_DIMENSION
  ) {
    return fail(`Зураг ${MIN_DIMENSION}–${MAX_DIMENSION}px хооронд байх ёстой.`)
  }

  const { error } = await supabase.rpc('publish_image', {
    p_image_id: imageId,
    p_width: dims.width,
    p_height: dims.height,
    p_byte_size: info.byteSize,
  })
  if (error) return { ok: false, message: toUserMessage(error, 'publishImage') }

  revalidatePath('/my-books')
  revalidatePath('/')
  return { ok: true }
}

export async function removeImageAction(imageId: string): Promise<ImageState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }
  if (!idSchema.safeParse(imageId).success) return { ok: false, message: 'Буруу хүсэлт.' }

  const { data: image } = await supabase
    .from('book_images')
    .select('storage_key')
    .eq('id', imageId)
    .maybeSingle()

  // Soft delete: the row stays so a moderator can still see what was uploaded.
  const { error } = await supabase
    .from('book_images')
    .update({ status: 'removed' })
    .eq('id', imageId)
  if (error) return { ok: false, message: toUserMessage(error, 'removeImage') }

  if (image) await bookImageStorage().delete(image.storage_key).catch(() => {})

  revalidatePath('/my-books')
  revalidatePath('/')
  return { ok: true }
}

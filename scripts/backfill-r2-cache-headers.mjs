/**
 * Give the images already in R2 the cache header that new uploads now get.
 *
 * R2 returns whatever Cache-Control an object was stored with, and everything
 * uploaded before src/lib/storage/r2.ts started sending one has none at all.
 * A response with no Cache-Control is left to the browser's heuristics, which in
 * practice means a conditional request per image per visit — and a feed is
 * twenty images before anything is drawn.
 *
 * S3 and R2 have no "change the headers" call, so each object is copied onto
 * itself with MetadataDirective=REPLACE. The bytes are not re-uploaded and the
 * key does not change; the object gets a new etag and last-modified, and its
 * content type is carried across from the object as it stands.
 *
 * Safe to stop and re-run: an object that already carries the header is skipped,
 * so a second run costs one HEAD per object and writes nothing.
 *
 * Usage, from the repository root:
 *
 *   node --env-file=.env.local scripts/backfill-r2-cache-headers.mjs
 *       Reports what it would change and writes nothing.
 *
 *   node --env-file=.env.local scripts/backfill-r2-cache-headers.mjs --apply
 *       Does it.
 *
 * Reads R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and
 * R2_BUCKET_NAME from the environment. Nothing is printed that would disclose
 * them.
 */

import {
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'

// Must match IMMUTABLE in src/lib/storage/r2.ts. A key contains a uuid and the
// bytes under it are never rewritten — a new photo is a new key — so an object
// may be cached until the browser forgets it.
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

// How many objects to work on at once. R2 is not the constraint here; this is
// low enough to stay polite on a laptop connection and finish a few thousand
// objects in a minute or two.
const CONCURRENCY = 8

const apply = process.argv.includes('--apply')

const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
const missing = required.filter((k) => !(process.env[k] ?? '').trim())
if (missing.length > 0) {
  console.error(
    `\n  ✗ Дараах хувьсагчид алга: ${missing.join(', ')}\n` +
      `    .env.local дотор байгаа эсэхийг шалгаад, скриптийг ингэж ажиллуулна уу:\n` +
      `    node --env-file=.env.local scripts/backfill-r2-cache-headers.mjs\n`
  )
  process.exit(1)
}

const bucket = process.env.R2_BUCKET_NAME
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

/** Every key in the bucket, a page at a time. */
async function* allKeys() {
  let token
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token })
    )
    for (const object of page.Contents ?? []) if (object.Key) yield object.Key
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
}

/**
 * A CopySource is "bucket/key", URI-encoded — but the slashes inside the key are
 * path separators and have to survive, so each segment is encoded on its own.
 */
function copySource(key) {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
}

const stats = { seen: 0, already: 0, updated: 0, failed: 0 }
const failures = []

async function fix(key) {
  stats.seen++
  let head
  try {
    head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  } catch (error) {
    stats.failed++
    failures.push(`${key}: ${error.name ?? error}`)
    return
  }

  if (head.CacheControl === CACHE_CONTROL) {
    stats.already++
    return
  }
  if (!apply) {
    stats.updated++
    return
  }

  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: key,
        CopySource: copySource(key),
        MetadataDirective: 'REPLACE',
        // Carried across deliberately: REPLACE drops everything not restated
        // here, and an image served as application/octet-stream would download
        // instead of render.
        ContentType: head.ContentType ?? 'application/octet-stream',
        CacheControl: CACHE_CONTROL,
      })
    )
    stats.updated++
  } catch (error) {
    stats.failed++
    failures.push(`${key}: ${error.name ?? error}`)
  }
}

console.log(
  `\n  ${bucket} · ${apply ? 'бичиж байна' : 'ЗӨВХӨН ХАРУУЛЖ БАЙНА (--apply өгвөл бичнэ)'}\n`
)

const running = new Set()
for await (const key of allKeys()) {
  const job = fix(key).finally(() => running.delete(job))
  running.add(job)
  if (running.size >= CONCURRENCY) await Promise.race(running)
  if (stats.seen % 200 === 0) process.stdout.write(`  … ${stats.seen}\r`)
}
await Promise.all(running)

console.log(
  `\n  Нийт:            ${stats.seen}\n` +
    `  Аль хэдийн зөв:  ${stats.already}\n` +
    `  ${apply ? 'Шинэчилсэн:     ' : 'Шинэчлэх ёстой: '} ${stats.updated}\n` +
    `  Алдаа:           ${stats.failed}\n`
)
for (const line of failures.slice(0, 20)) console.error(`    ✗ ${line}`)
if (failures.length > 20) console.error(`    … бас ${failures.length - 20}`)

if (!apply && stats.updated > 0) {
  console.log(`  Бичихийн тулд: node --env-file=.env.local ${process.argv[1]} --apply\n`)
}

process.exit(stats.failed > 0 ? 1 : 0)

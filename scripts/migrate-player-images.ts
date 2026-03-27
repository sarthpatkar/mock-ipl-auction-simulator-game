import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, '../.env.local')

function loadLocalEnv() {
  if (!existsSync(envPath)) return

  const envText = readFileSync(envPath, 'utf8')
  for (const rawLine of envText.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')

    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

loadLocalEnv()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const bucketName = process.env.SUPABASE_PLAYER_IMAGE_BUCKET || 'player-images'

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL in .env.local')
}

if (!serviceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local')
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function ensureBucket() {
  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) throw new Error(`Failed to list buckets: ${error.message}`)

  if (!buckets.some((bucket) => bucket.name === bucketName)) {
    const { error: createError } = await supabase.storage.createBucket(bucketName, {
      public: true
    })
    if (createError) throw new Error(`Failed to create bucket "${bucketName}": ${createError.message}`)
  }
}

async function migrate() {
  await ensureBucket()

  const { data: players, error } = await supabase
    .from('players')
    .select('id, name, image_url')

  if (error) {
    throw new Error(`Failed to load players: ${error.message}`)
  }

  let migrated = 0
  let skipped = 0

  for (const player of players ?? []) {
    if (!player.image_url) {
      skipped += 1
      continue
    }

    if (player.image_url.includes('/storage/v1/object/public/')) {
      skipped += 1
      continue
    }

    try {
      const response = await fetch(player.image_url)
      if (!response.ok) {
        console.warn(`Skipping ${player.name}: ${response.status} ${response.statusText}`)
        skipped += 1
        continue
      }

      const sourceBuffer = Buffer.from(await response.arrayBuffer())
      const webpBuffer = await sharp(sourceBuffer)
        .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer()

      const objectPath = `${player.id}.webp`
      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(objectPath, webpBuffer, {
          contentType: 'image/webp',
          upsert: true,
          cacheControl: '31536000'
        })

      if (uploadError) {
        console.warn(`Upload failed for ${player.name}: ${uploadError.message}`)
        skipped += 1
        continue
      }

      const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(objectPath)
      const { error: updateError } = await supabase
        .from('players')
        .update({ image_url: publicUrlData.publicUrl })
        .eq('id', player.id)

      if (updateError) {
        console.warn(`DB update failed for ${player.name}: ${updateError.message}`)
        skipped += 1
        continue
      }

      migrated += 1
      console.log(`Migrated ${player.name}`)
    } catch (error) {
      console.warn(`Skipping ${player.name}: ${(error as Error).message}`)
      skipped += 1
    }
  }

  console.log(`Done. Migrated ${migrated} images, skipped ${skipped}.`)
}

migrate().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

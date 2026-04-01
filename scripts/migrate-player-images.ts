import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

  const { data: players, error } = await supabase.from('players').select('id, name, image_url')

  if (error) {
    throw new Error(`Failed to load players: ${error.message}`)
  }

  const missing: string[] = []
  const external: string[] = []
  const internal: string[] = []

  for (const player of players ?? []) {
    if (!player.image_url) {
      missing.push(player.name)
      continue
    }

    if (player.image_url.includes('/storage/v1/object/public/')) {
      internal.push(player.name)
      continue
    }
    external.push(`${player.name}: ${player.image_url}`)
  }

  console.log(`Bucket "${bucketName}" is ready for manual AI avatar uploads.`)
  console.log(`Players with internal avatar URLs: ${internal.length}`)
  console.log(`Players missing avatars: ${missing.length}`)
  console.log(`Players still pointing to non-storage URLs: ${external.length}`)

  if (external.length > 0) {
    console.log('\nReplace these with uploaded AI avatar URLs using supabase/player_image_manual_update.sql:')
    external.slice(0, 25).forEach((entry) => console.log(`- ${entry}`))
    if (external.length > 25) {
      console.log(`- ...and ${external.length - 25} more`)
    }
    process.exitCode = 1
  }
}

migrate().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

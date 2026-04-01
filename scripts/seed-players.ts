import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
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

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL. Add it to .env.local before seeding.')
}

if (!serviceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local before seeding.')
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

type Player = {
  name: string
  age: number
  nationality: string
  batting_style: string
  bowling_style: string | null
  image: string | null
  spouse: string | null
  base_price: number
  base_price_label: string
}

async function seedPlayers() {
  const filePath = path.resolve(__dirname, '../public/t20_auction_pool_2026.json')
  const raw = await readFile(filePath, 'utf8')
  const auctionData = JSON.parse(raw) as { teams: any[] }
  const rows: object[] = []

  const { count, error: countError } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    console.error('Failed to check existing players:', countError.message)
    process.exit(1)
  }

  if ((count ?? 0) > 0) {
    console.log(`Players table already has ${count} rows. Skipping seed to avoid duplicates.`)
    return
  }

  for (const team of (auctionData as any).teams) {
    const { players } = team
    const roleMap: Record<string, string> = {
      batters: 'batter',
      wicketkeepers: 'wicketkeeper',
      allrounders: 'allrounder',
      bowlers: 'bowler'
    }

    for (const [roleKey, roleLabel] of Object.entries(roleMap)) {
      const roleGroup = players[roleKey as keyof typeof players] as
        | { capped: Player[]; uncapped: Player[] }
        | undefined

      if (!roleGroup) continue

      for (const [cap, playerList] of Object.entries(roleGroup)) {
        for (const p of playerList as Player[]) {
          rows.push({
            name: p.name,
            age: p.age,
            nationality: p.nationality,
            team_code: team.team,
            role: roleLabel,
            category: cap, // 'capped' | 'uncapped'
            batting_style: p.batting_style,
            bowling_style: p.bowling_style,
            image_url: p.image,
            base_price: p.base_price,
            base_price_label: p.base_price_label,
            spouse: p.spouse
          })
        }
      }
    }
  }

  console.log(`Seeding ${rows.length} players...`)

  const { error } = await supabase.from('players').insert(rows)
  if (error) {
    console.error('Seed failed:', error.message)
    process.exit(1)
  }

  console.log(`✅ Seeded ${rows.length} players successfully`)
}

seedPlayers()

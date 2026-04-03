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

type LegendPlayerRow = {
  name: string
  role: 'batter' | 'wicketkeeper' | 'allrounder' | 'bowler'
  category?: 'capped' | 'uncapped'
  nationality?: string | null
  latest_team_code?: string | null
  batting_style?: string | null
  bowling_style?: string | null
  image_url?: string | null
  base_price: number
  base_price_label?: string | null
  team_history?: unknown
  ipl_seasons?: unknown
  career_batting_stats?: unknown
  career_bowling_stats?: unknown
  career_fielding_stats?: unknown
  overall_rating?: number | null
  special_tags?: unknown
  matches?: number | null
  batting_avg?: number | null
  strike_rate?: number | null
  wickets?: number | null
  economy?: number | null
  performance_score?: number | null
  consistency_score?: number | null
  recent_form_score?: number | null
  experience_level?: string | null
  impact_type?: string | null
}

type LegendsFile = {
  players: LegendPlayerRow[]
}

async function seedLegendPlayers() {
  const filePath = path.resolve(__dirname, '../public/legends_auction_pool.json')
  const raw = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw) as LegendsFile
  const rows = Array.isArray(parsed.players) ? parsed.players : []

  if (rows.length === 0) {
    console.log('No legend players found in public/legends_auction_pool.json. Skipping.')
    return
  }

  const { error } = await supabase.from('legend_players').upsert(
    rows.map((row) => ({
      name: row.name,
      role: row.role,
      category: row.category ?? 'capped',
      nationality: row.nationality ?? null,
      latest_team_code: row.latest_team_code ?? null,
      batting_style: row.batting_style ?? null,
      bowling_style: row.bowling_style ?? null,
      image_url: row.image_url ?? null,
      base_price: row.base_price,
      base_price_label: row.base_price_label ?? null,
      team_history: row.team_history ?? [],
      ipl_seasons: row.ipl_seasons ?? [],
      career_batting_stats: row.career_batting_stats ?? {},
      career_bowling_stats: row.career_bowling_stats ?? {},
      career_fielding_stats: row.career_fielding_stats ?? {},
      overall_rating: row.overall_rating ?? null,
      special_tags: row.special_tags ?? [],
      matches: row.matches ?? null,
      batting_avg: row.batting_avg ?? null,
      strike_rate: row.strike_rate ?? null,
      wickets: row.wickets ?? null,
      economy: row.economy ?? null,
      performance_score: row.performance_score ?? null,
      consistency_score: row.consistency_score ?? null,
      recent_form_score: row.recent_form_score ?? null,
      experience_level: row.experience_level ?? null,
      impact_type: row.impact_type ?? null
    })),
    { onConflict: 'name' }
  )

  if (error) {
    throw new Error(`Failed to seed legend players: ${error.message}`)
  }

  console.log(`Seeded or updated ${rows.length} legend players successfully`)
}

seedLegendPlayers().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Failed to seed legend players')
  process.exit(1)
})

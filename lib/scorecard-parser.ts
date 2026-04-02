import crypto from 'crypto'
import { calculateFantasyStylePoints } from '@/lib/match-auction'
import { Match, Player } from '@/types'

export type ParsedMatchStatRow = {
  source_player_name: string
  mapped_player_id: string | null
  player_name_snapshot: string
  team_code: string
  did_play: boolean
  is_playing_xi: boolean
  is_substitute: boolean
  parse_confidence: number | null
  runs: number
  balls: number
  fours: number
  sixes: number
  wickets: number
  overs: number
  maidens: number
  economy: number | null
  catches: number
  stumpings: number
  run_outs: number
  row_status: 'parsed' | 'needs_review' | 'ignored'
}

export type ParsedScorecardPayload = {
  match_id: string
  rows: ParsedMatchStatRow[]
  unresolved_rows: Array<{ source_text: string; reason: string }>
}

export type ParseAttemptDiagnostic = {
  provider: 'groq' | 'openrouter' | 'heuristic'
  model: string
  status:
    | 'groq_success'
    | 'groq_invalid_json'
    | 'groq_validation_failed'
    | 'groq_quality_rejected'
    | 'groq_timeout'
    | 'groq_request_failed'
    | 'groq_repair_success'
    | 'groq_repair_failed'
    | 'openrouter_fallback_used'
    | 'openrouter_invalid_json'
    | 'openrouter_validation_failed'
    | 'openrouter_quality_rejected'
    | 'openrouter_timeout'
    | 'openrouter_rate_limited'
    | 'openrouter_request_failed'
    | 'heuristic_emergency_fallback'
  message: string
}

const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-coder:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'arcee-ai/trinity-large-preview:free',
  'arcee-ai/trinity-mini:free',
  'stepfun/step-3.5-flash:free',
  'liquid/lfm-2.5-1.2b-thinking:free',
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'google/gemma-3-27b-it:free'
] as const
const PARSE_TOTAL_TIMEOUT_MS = 60_000
const GROQ_TIMEOUT_MS = 40_000
const OPENROUTER_TIMEOUT_MS = 20_000
const OPENROUTER_MAX_MODELS = 2
const MIN_AI_PARSED_ROWS = 8
const MIN_AI_ROW_COVERAGE_RATIO = 0.55
const MAX_EMPTY_AI_ROWS = 4
const MAX_EMPTY_AI_ROW_RATIO = 0.25

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  const keys = Object.keys(value).sort()
  return keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index])
}

function asNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${field}`)
  }
  return value
}

function assertBoolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid boolean value for ${field}`)
  }
  return value
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function findPlayerByName(players: Player[], value: string, teamCodes: string[]) {
  const normalized = normalizeName(value)
  return (
    players.find((player) => normalizeName(player.name) === normalized && teamCodes.includes(player.team_code || '')) ??
    players.find((player) => normalizeName(player.name).includes(normalized) && teamCodes.includes(player.team_code || '')) ??
    null
  )
}

function findPlayerMentionInLine(players: Player[], value: string, teamCodes: string[]) {
  const normalizedLine = normalizeName(value)
  if (!normalizedLine) return null

  const lineTokens = normalizedLine.split(' ').filter(Boolean)
  let bestMatch: Player | null = null
  let bestLength = 0

  for (const player of players) {
    const teamCode = player.team_code || ''
    if (!teamCodes.includes(teamCode)) continue

    const normalizedPlayer = normalizeName(player.name)
    if (!normalizedPlayer) continue
    const playerTokens = normalizedPlayer.split(' ').filter(Boolean)
    const allTokensPresent = playerTokens.every((token) => lineTokens.includes(token))
    const exactPhrasePresent = normalizedLine.includes(normalizedPlayer)
    const singleTokenExact = playerTokens.length === 1 && lineTokens.includes(playerTokens[0] || '') && normalizedPlayer.length >= 4

    if (normalizedLine === normalizedPlayer || exactPhrasePresent || allTokensPresent || singleTokenExact) {
      if (normalizedPlayer.length > bestLength) {
        bestMatch = player
        bestLength = normalizedPlayer.length
      }
    }
  }

  return bestMatch
}

function createBaseParsedRow(player: Player, sourcePlayerName?: string): ParsedMatchStatRow {
  return {
    source_player_name: sourcePlayerName || player.name,
    mapped_player_id: player.id,
    player_name_snapshot: player.name,
    team_code: player.team_code || '',
    did_play: true,
    is_playing_xi: true,
    is_substitute: false,
    parse_confidence: 0.55,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    wickets: 0,
    overs: 0,
    maidens: 0,
    economy: null,
    catches: 0,
    stumpings: 0,
    run_outs: 0,
    row_status: 'needs_review'
  }
}

function isLikelyNoiseLine(value: string) {
  const normalized = normalizeName(value)
  if (!normalized) return true

  return [
    'extras',
    'total',
    'yet to bat',
    'did not bat',
    'fall of wickets',
    'fall of wicket',
    'powerplay',
    'inning break',
    'innings break',
    'target',
    'won by',
    'match tied',
    'dls',
    'required run rate',
    'partnership'
  ].some((token) => normalized.includes(token))
}

function detectSectionHint(value: string): 'batting' | 'bowling' | null {
  const normalized = normalizeName(value)
  if (!normalized) return null
  if (normalized.includes('bowling') || normalized.includes('bowler')) return 'bowling'
  if (normalized.includes('batting') || normalized.includes('batter') || normalized.includes('batsman')) return 'batting'
  return null
}

function extractNumberTokens(value: string) {
  return (value.match(/\d+(?:\.\d+)?/g) ?? []).map((token) => Number(token))
}

function parseBattingTokens(tokens: number[]) {
  if (tokens.length < 2) return null

  const relevant = tokens.length >= 5 ? tokens.slice(-5) : tokens.slice(-4)

  return {
    runs: Math.max(0, Math.round(relevant[0] ?? 0)),
    balls: Math.max(0, Math.round(relevant[1] ?? 0)),
    fours: Math.max(0, Math.round(relevant[2] ?? 0)),
    sixes: Math.max(0, Math.round(relevant[3] ?? 0))
  }
}

function parseBowlingTokens(tokens: number[]) {
  if (tokens.length < 4) return null

  const relevant = tokens.slice(0, 5)
  const overs = Number(relevant[0] ?? 0)
  const maidens = Math.max(0, Math.round(relevant[1] ?? 0))
  const runsConceded = Math.max(0, Math.round(relevant[2] ?? 0))
  const wickets = Math.max(0, Math.round(relevant[3] ?? 0))
  const economy = relevant.length >= 5 ? Number(relevant[4]) : overs > 0 ? Number((runsConceded / overs).toFixed(2)) : null

  if (!Number.isFinite(overs) || overs < 0 || overs > 4) return null

  return {
    overs,
    maidens,
    wickets,
    economy: economy != null && Number.isFinite(economy) ? economy : null
  }
}

function inferStatsFromTokens(tokens: number[], section: 'batting' | 'bowling' | 'unknown') {
  if (!tokens.length) return null

  const bowlingLooksLikely =
    section === 'bowling' ||
    (tokens.length >= 5 && tokens[0] <= 4 && Number.isFinite(tokens[4]) && String(tokens[4]).includes('.')) ||
    (tokens.length >= 4 && tokens[0] <= 4 && tokens[1] <= 6 && tokens[3] <= 10)

  if (bowlingLooksLikely) {
    const bowling = parseBowlingTokens(tokens)
    if (bowling) {
      return { kind: 'bowling' as const, stats: bowling }
    }
  }

  const batting = parseBattingTokens(tokens)
  if (batting) {
    return { kind: 'batting' as const, stats: batting }
  }

  const bowling = parseBowlingTokens(tokens)
  if (bowling) {
    return { kind: 'bowling' as const, stats: bowling }
  }

  return null
}

function applyParsedStats(
  row: ParsedMatchStatRow,
  parsed: ReturnType<typeof inferStatsFromTokens> | null
) {
  if (!parsed) return row

  if (parsed.kind === 'batting') {
    row.runs = Math.max(row.runs, parsed.stats.runs)
    row.balls = Math.max(row.balls, parsed.stats.balls)
    row.fours = Math.max(row.fours, parsed.stats.fours)
    row.sixes = Math.max(row.sixes, parsed.stats.sixes)
  } else {
    row.overs = Math.max(row.overs, parsed.stats.overs)
    row.maidens = Math.max(row.maidens, parsed.stats.maidens)
    row.wickets = Math.max(row.wickets, parsed.stats.wickets)
    row.economy = parsed.stats.economy ?? row.economy
  }

  const hasMeaningfulStats =
    row.runs > 0 ||
    row.balls > 0 ||
    row.fours > 0 ||
    row.sixes > 0 ||
    row.wickets > 0 ||
    row.overs > 0 ||
    row.maidens > 0 ||
    (row.economy ?? 0) > 0

  if (hasMeaningfulStats) {
    row.row_status = 'parsed'
    row.parse_confidence = Math.max(row.parse_confidence ?? 0, 0.72)
  }

  return row
}

function scoreParsedPayload(payload: ParsedScorecardPayload) {
  const mappedRows = payload.rows.filter((row) => row.mapped_player_id).length
  const statRows = payload.rows.filter((row) => {
    return (
      row.runs > 0 ||
      row.balls > 0 ||
      row.fours > 0 ||
      row.sixes > 0 ||
      row.wickets > 0 ||
      row.overs > 0 ||
      row.maidens > 0 ||
      (row.economy ?? 0) > 0
    )
  }).length

  return mappedRows * 5 + statRows * 10 - payload.unresolved_rows.length
}

function normalizeRawScorecard(value: string) {
  return value.replace(/\r\n?/g, '\n').trim()
}

function getMentionedPlayers(lines: string[], players: Player[], teamCodes: string[]) {
  const mentioned = new Map<string, Player>()

  for (const line of lines) {
    if (isLikelyNoiseLine(line)) continue
    const player = findPlayerMentionInLine(players, line, teamCodes) ?? findPlayerByName(players, line, teamCodes)
    if (player) {
      mentioned.set(player.id, player)
    }
  }

  return Array.from(mentioned.values())
}

function countEmptyRows(rows: ParsedMatchStatRow[]) {
  return rows.filter((row) => {
    return (
      row.runs === 0 &&
      row.balls === 0 &&
      row.fours === 0 &&
      row.sixes === 0 &&
      row.wickets === 0 &&
      row.overs === 0 &&
      row.maidens === 0 &&
      row.economy == null &&
      row.catches === 0 &&
      row.stumpings === 0 &&
      row.run_outs === 0
    )
  }).length
}

function assertPayloadQuality(payload: ParsedScorecardPayload, rawText: string, players: Player[], match: Match) {
  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean)
  const mentionedPlayers = getMentionedPlayers(lines, players, [match.team_a_code, match.team_b_code])
  const mentionedIds = new Set(mentionedPlayers.map((player) => player.id))
  const mappedRows = payload.rows.filter((row) => row.mapped_player_id)
  const mappedMentionedCount = mappedRows.filter((row) => row.mapped_player_id && mentionedIds.has(row.mapped_player_id)).length
  const emptyRowCount = countEmptyRows(mappedRows)
  const minimumCoverage = Math.max(MIN_AI_PARSED_ROWS, Math.floor(mentionedPlayers.length * MIN_AI_ROW_COVERAGE_RATIO))

  if (mappedRows.length < minimumCoverage) {
    throw new Error(`AI output covered only ${mappedRows.length} players; expected at least ${minimumCoverage}`)
  }

  if (mappedMentionedCount < minimumCoverage) {
    throw new Error(`AI output matched only ${mappedMentionedCount} clearly mentioned players; expected at least ${minimumCoverage}`)
  }

  if (
    emptyRowCount > MAX_EMPTY_AI_ROWS ||
    (mappedRows.length > 0 && emptyRowCount / mappedRows.length > MAX_EMPTY_AI_ROW_RATIO)
  ) {
    throw new Error(`AI output contains too many empty rows (${emptyRowCount}/${mappedRows.length})`)
  }

  return payload
}

function validateRow(row: ParsedMatchStatRow, players: Player[], teamCodes: string[]) {
  if (!teamCodes.includes(row.team_code)) {
    throw new Error(`Team code ${row.team_code} is not valid for this match`)
  }
  if (row.parse_confidence != null && (row.parse_confidence < 0 || row.parse_confidence > 1)) {
    throw new Error('parse_confidence must be between 0 and 1')
  }
  if (row.runs < 0 || row.balls < 0 || row.fours < 0 || row.sixes < 0 || row.wickets < 0 || row.maidens < 0 || row.catches < 0 || row.stumpings < 0 || row.run_outs < 0) {
    throw new Error(`Negative stats are not allowed for ${row.source_player_name}`)
  }
  if (row.overs < 0 || row.overs > 4) throw new Error(`Overs must be between 0 and 4 for ${row.source_player_name}`)
  if (row.wickets > 10) throw new Error(`Wickets must be between 0 and 10 for ${row.source_player_name}`)
  if (row.economy != null && (row.economy < 0 || row.economy > 36)) {
    throw new Error(`Economy is outside the expected T20 range for ${row.source_player_name}`)
  }

  if (row.mapped_player_id) {
    const mapped = players.find((player) => player.id === row.mapped_player_id)
    if (!mapped) throw new Error(`Mapped player ${row.mapped_player_id} does not exist`)
    if (!teamCodes.includes(mapped.team_code || '')) throw new Error(`Mapped player ${mapped.name} is outside the selected match teams`)
  }
}

export function validateParsedScorecardPayload(payload: unknown, players: Player[], match: Match) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Scorecard parser response must be a JSON object')
  }

  const root = payload as Record<string, unknown>
  if (!exactKeys(root, ['match_id', 'rows', 'unresolved_rows'])) {
    throw new Error('Scorecard parser returned unexpected root fields')
  }

  if (root.match_id !== match.id) {
    throw new Error('Scorecard parser returned a mismatched match_id')
  }

  if (!Array.isArray(root.rows) || !Array.isArray(root.unresolved_rows)) {
    throw new Error('rows and unresolved_rows must be arrays')
  }

  const teamCodes = [match.team_a_code, match.team_b_code]
  const seenMappedIds = new Set<string>()

  const rows = root.rows.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Each parsed row must be an object')
    }

    const row = item as Record<string, unknown>
    if (
      !exactKeys(row, [
        'source_player_name',
        'mapped_player_id',
        'player_name_snapshot',
        'team_code',
        'did_play',
        'is_playing_xi',
        'is_substitute',
        'parse_confidence',
        'runs',
        'balls',
        'fours',
        'sixes',
        'wickets',
        'overs',
        'maidens',
        'economy',
        'catches',
        'stumpings',
        'run_outs',
        'row_status'
      ])
    ) {
      throw new Error('Scorecard parser row returned unexpected fields')
    }

    if (typeof row.source_player_name !== 'string' || typeof row.player_name_snapshot !== 'string' || typeof row.team_code !== 'string') {
      throw new Error('Scorecard parser returned malformed player names or team code')
    }

    if (row.mapped_player_id != null && typeof row.mapped_player_id !== 'string') {
      throw new Error('mapped_player_id must be a string or null')
    }

    if (!['parsed', 'needs_review', 'ignored'].includes(String(row.row_status))) {
      throw new Error('row_status is invalid')
    }

    const parsedRow: ParsedMatchStatRow = {
      source_player_name: row.source_player_name,
      mapped_player_id: row.mapped_player_id as string | null,
      player_name_snapshot: row.player_name_snapshot,
      team_code: row.team_code,
      did_play: assertBoolean(row.did_play, 'did_play'),
      is_playing_xi: assertBoolean(row.is_playing_xi, 'is_playing_xi'),
      is_substitute: assertBoolean(row.is_substitute, 'is_substitute'),
      parse_confidence: row.parse_confidence == null ? null : asNumber(row.parse_confidence, 'parse_confidence'),
      runs: asNumber(row.runs, 'runs'),
      balls: asNumber(row.balls, 'balls'),
      fours: asNumber(row.fours, 'fours'),
      sixes: asNumber(row.sixes, 'sixes'),
      wickets: asNumber(row.wickets, 'wickets'),
      overs: asNumber(row.overs, 'overs'),
      maidens: asNumber(row.maidens, 'maidens'),
      economy: row.economy == null ? null : asNumber(row.economy, 'economy'),
      catches: asNumber(row.catches, 'catches'),
      stumpings: asNumber(row.stumpings, 'stumpings'),
      run_outs: asNumber(row.run_outs, 'run_outs'),
      row_status: row.row_status as ParsedMatchStatRow['row_status']
    }

    validateRow(parsedRow, players, teamCodes)
    if (parsedRow.mapped_player_id) {
      if (seenMappedIds.has(parsedRow.mapped_player_id)) {
        throw new Error(`Duplicate player mapping detected for ${parsedRow.source_player_name}`)
      }
      seenMappedIds.add(parsedRow.mapped_player_id)
    }

    return parsedRow
  })

  return {
    match_id: root.match_id as string,
    rows,
    unresolved_rows: (root.unresolved_rows as Array<{ source_text: string; reason: string }>).map((item) => ({
      source_text: String(item?.source_text ?? ''),
      reason: String(item?.reason ?? '')
    }))
  } satisfies ParsedScorecardPayload
}

function buildPrompt(match: Match, players: Player[], rawText: string) {
  const sampleFormat = [
    'Sample scorecard shape you must handle:',
    'Team A (20 ovs maximum)',
    'Batting',
    'Player Name',
    'dismissal line',
    'runs balls minutes fours sixes strike_rate',
    '...',
    'Bowling',
    'Bowler Name',
    'overs maidens runs wickets economy dots wides no_balls',
    '...',
    'Team B (target ...)',
    'Batting',
    '...',
    'Bowling',
    '...',
    'Ignore sections like Extras, Total, Did not bat, Fall of wickets, DRS.'
  ].join('\n')

  return [
    'You are an expert cricket scorecard parser.',
    'Your job is to convert one raw pasted two-innings cricket scorecard into exact JSON only.',
    'The raw scorecard may have player names, dismissal text, and numeric stat lines split across multiple lines.',
    'You must infer row grouping from the raw text exactly as a human scorekeeper would.',
    `Match id: ${match.id}`,
    `Allowed team codes: ${match.team_a_code}, ${match.team_b_code}`,
    'Allowed player mappings:',
    ...players.map((player) => `- ${player.id} | ${player.name} | ${player.team_code}`),
    sampleFormat,
    'Rules:',
    '- Return only JSON.',
    '- Root keys must be exactly: match_id, rows, unresolved_rows.',
    '- Each row must include only the requested schema keys.',
    '- Use mapped_player_id null when unsure.',
    '- The same player must appear at most once in rows.',
    '- Merge batting and bowling stats for the same player into a single final row.',
    '- If a player only batted, bowling stats should be zero/null.',
    '- If a player only bowled, batting stats should be zero.',
    '- Do not omit player_name_snapshot, source_player_name, or team_code.',
    '- Include players who clearly appeared in batting or bowling tables.',
    '- Do not create empty rows for noise text or summary text.',
    '- Keep malformed or partial rows in unresolved_rows rather than inventing values.',
    '- Never create duplicate mapped_player_id rows.',
    '- Never wrap the JSON in markdown or prose.',
    '- Ignore dismissal text except to determine which player row it belongs to.',
    '- Ignore Extras, Total, Did not bat, Fall of wickets, DRS, Powerplay, and summary lines as player rows.',
    '- Bowling lines can be wrapped across multiple lines. Merge them before deciding wickets/economy.',
    '- Batting stat order is generally runs, balls, minutes, fours, sixes, strike rate. Use runs, balls, fours, and sixes.',
    '- Bowling stat order is generally overs, maidens, runs, wickets, economy, followed by optional dot-ball/wide/no-ball columns.',
    'JSON row schema:',
    '{"source_player_name":"string","mapped_player_id":"string|null","player_name_snapshot":"string","team_code":"string","did_play":true,"is_playing_xi":true,"is_substitute":false,"parse_confidence":0.0,"runs":0,"balls":0,"fours":0,"sixes":0,"wickets":0,"overs":0,"maidens":0,"economy":0.0,"catches":0,"stumpings":0,"run_outs":0,"row_status":"parsed|needs_review|ignored"}',
    'Quality requirements:',
    '- Do not return rows with all-zero stats unless the player undeniably appears and you are unsure of the numbers.',
    '- Prefer unresolved_rows over guessing.',
    '- Mapped players must belong to the selected match teams only.',
    'Scorecard text:',
    rawText
  ].join('\n')
}

function buildRepairPrompt(
  match: Match,
  players: Player[],
  rawText: string,
  previousResponse: string,
  failureReason: string
) {
  return [
    buildPrompt(match, players, rawText),
    '',
    'Your previous answer was unusable.',
    `Failure reason: ${failureReason}`,
    'Return corrected JSON only.',
    'Do not explain the fix.',
    'Previous unusable response:',
    previousResponse
  ].join('\n')
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function tryGroq(prompt: string, timeoutMs = GROQ_TIMEOUT_MS) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return null

  const response = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You convert scorecards into strict JSON only. Do not include markdown.'
          },
          { role: 'user', content: prompt }
        ]
      })
    },
    timeoutMs
  )

  if (!response.ok) {
    throw new Error(`Groq request failed with ${response.status}`)
  }

  const json = await response.json()
  return {
    provider: 'groq',
    model: json.model ?? 'llama-3.3-70b-versatile',
    rawText: json.choices?.[0]?.message?.content ?? ''
  }
}

function classifyRequestFailure(error: unknown, provider: 'groq' | 'openrouter') {
  const message = error instanceof Error ? error.message : String(error)
  if (message.toLowerCase().includes('aborted')) {
    return {
      status: provider === 'groq' ? 'groq_timeout' : 'openrouter_timeout',
      message
    } as const
  }

  if (provider === 'openrouter' && message.includes('429')) {
    return {
      status: 'openrouter_rate_limited',
      message
    } as const
  }

  return {
    status: provider === 'groq' ? 'groq_request_failed' : 'openrouter_request_failed',
    message
  } as const
}

async function tryOpenRouter(prompt: string, deadlineAt: number) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  let lastError: Error | null = null

  for (const model of OPENROUTER_MODELS.slice(0, OPENROUTER_MAX_MODELS)) {
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs <= 1_000) {
      throw new Error('OpenRouter parse budget exhausted')
    }

    try {
      const response = await fetchWithTimeout(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: 'You convert scorecards into strict JSON only. Do not include markdown.'
              },
              { role: 'user', content: prompt }
            ]
          })
        },
        Math.min(OPENROUTER_TIMEOUT_MS, remainingMs)
      )

      if (!response.ok) {
        throw new Error(`OpenRouter request failed with ${response.status}`)
      }

      const json = await response.json()
      return {
        provider: 'openrouter',
        model,
        rawText: json.choices?.[0]?.message?.content ?? ''
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('OpenRouter request failed')
      if (lastError.message.includes('429')) {
        break
      }
    }
  }

  if (lastError) throw lastError
  return null
}

function stripCodeFences(value: string) {
  return value.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim()
}

function parseAndValidateAiPayload(
  aiResponseText: string,
  sourceScorecardText: string,
  players: Player[],
  match: Match
) {
  const parsedJson = JSON.parse(stripCodeFences(aiResponseText))
  const validated = validateParsedScorecardPayload(parsedJson, players, match)
  return assertPayloadQuality(validated, sourceScorecardText, players, match)
}

function buildFallbackRows(rawText: string, players: Player[], match: Match): ParsedScorecardPayload {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const rowsByPlayerId = new Map<string, ParsedMatchStatRow>()
  const unresolved_rows: Array<{ source_text: string; reason: string }> = []
  const teamCodes = [match.team_a_code, match.team_b_code]
  let currentSection: 'batting' | 'bowling' | 'unknown' = 'unknown'
  let pendingPlayer: Player | null = null
  let pendingSourceName = ''
  let pendingTokens: number[] = []
  let pendingSection: 'batting' | 'bowling' | 'unknown' = 'unknown'
  let pendingRawLine = ''

  const flushPendingPlayer = () => {
    if (!pendingPlayer) {
      pendingTokens = []
      return
    }

    const parsed = inferStatsFromTokens(pendingTokens, pendingSection)
    if (!parsed) {
      unresolved_rows.push({
        source_text: pendingRawLine || pendingSourceName,
        reason: 'Matched player but could not extract reliable stats'
      })
      pendingPlayer = null
      pendingSourceName = ''
      pendingTokens = []
      pendingSection = currentSection
      pendingRawLine = ''
      return
    }

    const existingRow = rowsByPlayerId.get(pendingPlayer.id) ?? createBaseParsedRow(pendingPlayer, pendingSourceName)
    existingRow.source_player_name = pendingSourceName || existingRow.source_player_name
    applyParsedStats(existingRow, parsed)
    rowsByPlayerId.set(pendingPlayer.id, existingRow)

    pendingPlayer = null
    pendingSourceName = ''
    pendingTokens = []
    pendingSection = currentSection
    pendingRawLine = ''
  }

  for (const line of lines) {
    const sectionHint = detectSectionHint(line)
    if (sectionHint) {
      flushPendingPlayer()
      currentSection = sectionHint
      continue
    }

    if (isLikelyNoiseLine(line)) {
      flushPendingPlayer()
      continue
    }

    const player = findPlayerMentionInLine(players, line, teamCodes) ?? findPlayerByName(players, line, teamCodes)
    if (player) {
      flushPendingPlayer()
      pendingPlayer = player
      pendingSourceName = player.name
      pendingSection = currentSection
      pendingTokens = extractNumberTokens(line)
      pendingRawLine = line
      continue
    }

    const numericTokens = extractNumberTokens(line)
    if (pendingPlayer && numericTokens.length > 0) {
      pendingTokens.push(...numericTokens)
      pendingRawLine = `${pendingRawLine}\n${line}`.trim()
      continue
    }

    if (numericTokens.length === 0 && line.length > 1) {
      unresolved_rows.push({ source_text: line, reason: 'Manual review required' })
    }
  }

  flushPendingPlayer()

  if (rowsByPlayerId.size < 4) {
    lines.forEach((line) => {
      if (isLikelyNoiseLine(line)) return
      const player = findPlayerMentionInLine(players, line, teamCodes) ?? findPlayerByName(players, line, teamCodes)
      if (!player || rowsByPlayerId.has(player.id)) return

      const parsed = inferStatsFromTokens(extractNumberTokens(line), currentSection)
      if (!parsed) return

      rowsByPlayerId.set(player.id, applyParsedStats(createBaseParsedRow(player, player.name), parsed))
    })
  }

  const rows = Array.from(rowsByPlayerId.values()).filter((row) => {
    return (
      row.runs > 0 ||
      row.balls > 0 ||
      row.fours > 0 ||
      row.sixes > 0 ||
      row.wickets > 0 ||
      row.overs > 0 ||
      row.maidens > 0 ||
      (row.economy ?? 0) > 0
    )
  })

  return {
    match_id: match.id,
    rows,
    unresolved_rows
  }
}

export async function parseScorecardWithFallback(rawText: string, match: Match, players: Player[]) {
  const normalizedRawText = normalizeRawScorecard(rawText)
  const prompt = buildPrompt(match, players, normalizedRawText)
  let provider: string | null = null
  let model: string | null = null
  let rawAiResponse: string | null = null
  let payload: ParsedScorecardPayload | null = null
  const heuristicPayload = buildFallbackRows(normalizedRawText, players, match)
  const diagnostics: ParseAttemptDiagnostic[] = []
  const deadlineAt = Date.now() + PARSE_TOTAL_TIMEOUT_MS

  try {
    const groq = await tryGroq(prompt, Math.min(GROQ_TIMEOUT_MS, Math.max(1_000, deadlineAt - Date.now())))
    if (groq?.rawText) {
      try {
        const validated = parseAndValidateAiPayload(groq.rawText, normalizedRawText, players, match)
        provider = groq.provider
        model = groq.model
        rawAiResponse = groq.rawText
        payload = validated
        diagnostics.push({
          provider: 'groq',
          model: groq.model ?? 'llama-3.3-70b-versatile',
          status: 'groq_success',
          message: `Groq returned ${validated.rows.length} validated rows`
        })
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : 'Groq response could not be validated'
        diagnostics.push({
          provider: 'groq',
          model: groq.model ?? 'llama-3.3-70b-versatile',
          status:
            error instanceof SyntaxError
              ? 'groq_invalid_json'
              : failureReason.toLowerCase().includes('covered only') ||
                  failureReason.toLowerCase().includes('matched only') ||
                  failureReason.toLowerCase().includes('too many empty rows')
                ? 'groq_quality_rejected'
                : 'groq_validation_failed',
          message: failureReason
        })

        try {
          const remainingMs = deadlineAt - Date.now()
          if (remainingMs > 5_000) {
            const repair = await tryGroq(
              buildRepairPrompt(match, players, normalizedRawText, groq.rawText, failureReason),
              Math.min(GROQ_TIMEOUT_MS, remainingMs)
            )

            if (repair?.rawText) {
              const repairedPayload = parseAndValidateAiPayload(repair.rawText, normalizedRawText, players, match)
              provider = repair.provider
              model = repair.model
              rawAiResponse = repair.rawText
              payload = repairedPayload
              diagnostics.push({
                provider: 'groq',
                model: repair.model ?? 'llama-3.3-70b-versatile',
                status: 'groq_repair_success',
                message: `Groq repair returned ${repairedPayload.rows.length} validated rows`
              })
            }
          }
        } catch (repairError) {
          diagnostics.push({
            provider: 'groq',
            model: groq.model ?? 'llama-3.3-70b-versatile',
            status: 'groq_repair_failed',
            message: repairError instanceof Error ? repairError.message : 'Groq repair attempt failed'
          })
        }
      }
    } else {
      diagnostics.push({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        status: 'groq_request_failed',
        message: 'Groq returned an empty response'
      })
    }
  } catch (error) {
    const classified = classifyRequestFailure(error, 'groq')
    diagnostics.push({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      status: classified.status,
      message: classified.message
    })
  }

  if (!payload) {
    try {
      const fallback = await tryOpenRouter(prompt, deadlineAt)
      if (fallback?.rawText) {
        try {
          const validated = parseAndValidateAiPayload(fallback.rawText, normalizedRawText, players, match)
          provider = fallback.provider
          model = fallback.model
          rawAiResponse = fallback.rawText
          payload = validated
          diagnostics.push({
            provider: 'openrouter',
            model: fallback.model,
            status: 'openrouter_fallback_used',
            message: `OpenRouter returned ${validated.rows.length} validated rows`
          })
        } catch (error) {
          const failureReason = error instanceof Error ? error.message : 'OpenRouter response could not be validated'
          diagnostics.push({
            provider: 'openrouter',
            model: fallback.model,
            status:
              error instanceof SyntaxError
                ? 'openrouter_invalid_json'
                : failureReason.toLowerCase().includes('covered only') ||
                    failureReason.toLowerCase().includes('matched only') ||
                    failureReason.toLowerCase().includes('too many empty rows')
                  ? 'openrouter_quality_rejected'
                  : 'openrouter_validation_failed',
            message: failureReason
          })
        }
      } else {
        diagnostics.push({
          provider: 'openrouter',
          model: 'fallback-chain',
          status: 'openrouter_request_failed',
          message: 'OpenRouter returned an empty response'
        })
      }
    } catch (error) {
      const classified = classifyRequestFailure(error, 'openrouter')
      diagnostics.push({
        provider: 'openrouter',
        model: 'fallback-chain',
        status: classified.status,
        message: classified.message
      })
    }
  }

  if (!payload) {
    diagnostics.push({
      provider: 'heuristic',
      model: 'deterministic-scorecard-parser',
      status: 'heuristic_emergency_fallback',
      message: `Heuristic parser was used as the emergency fallback with ${heuristicPayload.rows.length} rows and ${heuristicPayload.unresolved_rows.length} unresolved lines`
    })
    payload = heuristicPayload
    provider = 'heuristic'
    model = 'deterministic-scorecard-parser'
  }

  return {
    provider,
    model,
    rawAiResponse,
    payload,
    diagnostics
  }
}

export function buildScorecardContentHash(rawText: string) {
  return crypto.createHash('sha256').update(rawText.trim()).digest('hex')
}

export function materializePublishedRows(rows: ParsedMatchStatRow[]) {
  return rows
    .filter((row) => row.row_status !== 'ignored' && row.mapped_player_id)
    .map((row) => ({
      ...row,
      player_id: row.mapped_player_id!,
      fantasy_points: calculateFantasyStylePoints({
        runs: row.runs,
        balls: row.balls,
        fours: row.fours,
        sixes: row.sixes,
        wickets: row.wickets,
        overs: row.overs,
        maidens: row.maidens,
        economy: row.economy,
        catches: row.catches,
        stumpings: row.stumpings,
        run_outs: row.run_outs
      })
    }))
}

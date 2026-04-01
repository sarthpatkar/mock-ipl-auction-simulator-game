import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_DB_CSV = '/Users/sarth/Downloads/players_rows-2.csv'
const DEFAULT_ENRICHED_CSV = '/Users/sarth/Downloads/t20_player_enriched.csv'
const DEFAULT_OUT_DIR = path.resolve(__dirname, '../supabase/imports')

const STAT_COLUMNS = [
  'matches',
  'batting_avg',
  'strike_rate',
  'wickets',
  'economy',
  'performance_score',
  'consistency_score',
  'recent_form_score',
  'experience_level',
  'impact_type'
] as const

const ROLE_MAP: Record<string, string> = {
  BAT: 'batter',
  WK: 'wicketkeeper',
  AR: 'allrounder',
  BOWL: 'bowler'
}

const OUTLIER_BOUNDS: Record<
  string,
  {
    batting_avg: [number, number]
    strike_rate: [number, number]
  }
> = {
  batter: {
    batting_avg: [0, 80],
    strike_rate: [50, 250]
  },
  wicketkeeper: {
    batting_avg: [0, 80],
    strike_rate: [50, 250]
  },
  allrounder: {
    batting_avg: [0, 60],
    strike_rate: [40, 220]
  },
  bowler: {
    batting_avg: [0, 30],
    strike_rate: [20, 200]
  }
}

type StatColumn = (typeof STAT_COLUMNS)[number]

type Row = Record<string, string>

type Flag = {
  type: 'outlier' | 'invalid_numeric' | 'nationality_not_validated'
  field?: string
  message: string
}

type UpdatedRowAudit = {
  id: string
  name: string
  normalized_name: string
  db_role: string
  enriched_role: string
  updated_fields: string[]
  flags: Flag[]
}

type SkipAudit = {
  name: string
  normalized_name: string
  reason: 'ambiguous_name' | 'role_mismatch'
  enriched_role: string
  db_role?: string
  candidate_ids?: string[]
}

type QuarantinedRow = {
  name: string
  normalized_name: string
  reason: 'enriched_only_no_exact_db_match'
  enriched_row: Row
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_')
}

function parseArgs(argv: string[]) {
  const args = {
    db: DEFAULT_DB_CSV,
    enriched: DEFAULT_ENRICHED_CSV,
    outDir: DEFAULT_OUT_DIR
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--db' && next) {
      args.db = next
      i += 1
    } else if (arg === '--enriched' && next) {
      args.enriched = next
      i += 1
    } else if (arg === '--out-dir' && next) {
      args.outDir = next
      i += 1
    }
  }

  return args
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        currentField += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentField)
      currentField = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1
      }

      currentRow.push(currentField)
      if (currentRow.some((value) => value.length > 0)) {
        rows.push(currentRow)
      }
      currentRow = []
      currentField = ''
      continue
    }

    currentField += char
  }

  currentRow.push(currentField)
  if (currentRow.some((value) => value.length > 0)) {
    rows.push(currentRow)
  }

  return rows
}

function stringifyCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const safe = value ?? ''
          if (/[",\n\r]/.test(safe)) {
            return `"${safe.replace(/"/g, '""')}"`
          }
          return safe
        })
        .join(',')
    )
    .join('\n')
}

function rowsToObjects(parsed: string[][]): { header: string[]; rows: Row[] } {
  if (parsed.length === 0) {
    throw new Error('CSV is empty')
  }

  const header = parsed[0].map((value) => value.trim())
  const rows = parsed.slice(1).map((row) => {
    const record: Row = {}
    header.forEach((column, index) => {
      record[column] = (row[index] ?? '').trim()
    })
    return record
  })

  return { header, rows }
}

function buildCanonicalAccessor(header: string[]) {
  const canonicalMap = new Map<string, string>()
  for (const column of header) {
    canonicalMap.set(normalizeHeader(column), column)
  }

  return {
    get(row: Row, key: string): string {
      const actual = canonicalMap.get(normalizeHeader(key))
      return actual ? row[actual] ?? '' : ''
    }
  }
}

function parseInteger(
  value: string,
  field: string,
  flags: Flag[],
  options: { min?: number } = {}
): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^-?\d+$/.test(trimmed)) {
    flags.push({
      type: 'invalid_numeric',
      field,
      message: `${field} is not a valid integer: "${trimmed}"`
    })
    return null
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || (options.min !== undefined && parsed < options.min)) {
    flags.push({
      type: 'invalid_numeric',
      field,
      message: `${field} must be >= ${options.min ?? 0}: "${trimmed}"`
    })
    return null
  }

  return String(parsed)
}

function parseDecimal(value: string, field: string, flags: Flag[]): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    flags.push({
      type: 'invalid_numeric',
      field,
      message: `${field} is not a valid number: "${trimmed}"`
    })
    return null
  }

  return trimmed
}

function addOutlierFlags(row: Row, flags: Flag[]) {
  const role = row.role.trim()
  const bounds = OUTLIER_BOUNDS[role]
  const hasStatData = STAT_COLUMNS.some((column) => (row[column] ?? '').trim() !== '')

  if (!bounds || !hasStatData) return

  const addRangeFlag = (field: 'batting_avg' | 'strike_rate', min: number, max: number) => {
    const raw = row[field]?.trim() ?? ''
    if (!raw) return

    const value = Number(raw)
    if (!Number.isFinite(value)) {
      flags.push({
        type: 'invalid_numeric',
        field,
        message: `${field} is not a valid number in final output: "${raw}"`
      })
      return
    }

    if (value < min || value > max) {
      flags.push({
        type: 'outlier',
        field,
        message: `${field}=${raw} is outside the expected ${role} range ${min}-${max}`
      })
    }
  }

  addRangeFlag('batting_avg', bounds.batting_avg[0], bounds.batting_avg[1])
  addRangeFlag('strike_rate', bounds.strike_rate[0], bounds.strike_rate[1])

  const performanceScore = row.performance_score?.trim() ?? ''
  if (performanceScore) {
    const value = Number(performanceScore)
    if (!Number.isFinite(value)) {
      flags.push({
        type: 'invalid_numeric',
        field: 'performance_score',
        message: `performance_score is not a valid number in final output: "${performanceScore}"`
      })
    } else if (value < 40 || value > 95) {
      flags.push({
        type: 'outlier',
        field: 'performance_score',
        message: `performance_score=${performanceScore} is outside the expected range 40-95`
      })
    }
  }

  const wicketsRaw = row.wickets?.trim() ?? ''
  if ((role === 'batter' || role === 'wicketkeeper') && wicketsRaw) {
    const wickets = Number(wicketsRaw)
    if (Number.isFinite(wickets) && wickets !== 0) {
      flags.push({
        type: 'outlier',
        field: 'wickets',
        message: `wickets=${wicketsRaw} is unexpected for role ${role}`
      })
    }
  }

  const economyRaw = row.economy?.trim() ?? ''
  if (role === 'batter' || role === 'wicketkeeper') {
    if (economyRaw && Number(economyRaw) !== 0) {
      flags.push({
        type: 'outlier',
        field: 'economy',
        message: `economy=${economyRaw} is unexpected for role ${role}`
      })
    }
  } else if (!economyRaw) {
    flags.push({
      type: 'outlier',
      field: 'economy',
      message: `economy is missing for role ${role}`
    })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!existsSync(args.db)) {
    throw new Error(`DB CSV not found: ${args.db}`)
  }

  if (!existsSync(args.enriched)) {
    throw new Error(`Enriched CSV not found: ${args.enriched}`)
  }

  await mkdir(args.outDir, { recursive: true })

  const dbText = await readFile(args.db, 'utf8')
  const enrichedText = await readFile(args.enriched, 'utf8')

  const dbParsed = rowsToObjects(parseCsv(dbText))
  const enrichedParsed = rowsToObjects(parseCsv(enrichedText))
  const dbAccessor = buildCanonicalAccessor(dbParsed.header)
  const enrichedAccessor = buildCanonicalAccessor(enrichedParsed.header)

  const baseHeader = dbParsed.header.filter((column) => !STAT_COLUMNS.includes(column as StatColumn))
  const outputHeader = [...baseHeader, ...STAT_COLUMNS]

  for (const required of ['id', 'name', 'role']) {
    if (!baseHeader.includes(required)) {
      throw new Error(`DB CSV is missing required column "${required}"`)
    }
  }

  for (const required of ['name', 'role']) {
    if (!enrichedParsed.header.some((column) => normalizeHeader(column) === required)) {
      throw new Error(`Enriched CSV is missing required column "${required}"`)
    }
  }

  const nameToBaseRows = new Map<string, Row[]>()
  const outputRows = dbParsed.rows.map((row) => {
    const outputRow: Row = {}
    for (const column of baseHeader) {
      outputRow[column] = row[column] ?? ''
    }
    for (const column of STAT_COLUMNS) {
      outputRow[column] = row[column] ?? ''
    }

    const normalizedName = normalizeName(outputRow.name ?? '')
    const group = nameToBaseRows.get(normalizedName) ?? []
    group.push(outputRow)
    nameToBaseRows.set(normalizedName, group)

    return outputRow
  })

  const updatedRowsAudit: UpdatedRowAudit[] = []
  const skippedUpdates: SkipAudit[] = []
  const quarantinedRows: QuarantinedRow[] = []
  const rowAuditById = new Map<string, UpdatedRowAudit>()

  for (const enrichedRow of enrichedParsed.rows) {
    const enrichedName = enrichedAccessor.get(enrichedRow, 'name')
    const normalizedName = normalizeName(enrichedName)
    const matches = nameToBaseRows.get(normalizedName) ?? []
    const enrichedRoleCode = enrichedAccessor.get(enrichedRow, 'role').trim().toUpperCase()
    const mappedRole = ROLE_MAP[enrichedRoleCode] ?? ''

    if (matches.length === 0) {
      quarantinedRows.push({
        name: enrichedName,
        normalized_name: normalizedName,
        reason: 'enriched_only_no_exact_db_match',
        enriched_row: enrichedRow
      })
      continue
    }

    if (matches.length > 1) {
      skippedUpdates.push({
        name: enrichedName,
        normalized_name: normalizedName,
        reason: 'ambiguous_name',
        enriched_role: enrichedRoleCode,
        candidate_ids: matches.map((row) => row.id)
      })
      continue
    }

    const targetRow = matches[0]
    if (targetRow.role.trim() !== mappedRole) {
      skippedUpdates.push({
        name: enrichedName,
        normalized_name: normalizedName,
        reason: 'role_mismatch',
        enriched_role: enrichedRoleCode,
        db_role: targetRow.role
      })
      continue
    }

    const flags: Flag[] = [
      {
        type: 'nationality_not_validated',
        field: 'nationality',
        message: 'Nationality was not validated because the enriched CSV does not include nationality'
      }
    ]
    const updatedFields: string[] = []

    const updateIntegerField = (field: 'matches' | 'wickets' | 'performance_score', minimum = 0) => {
      const parsed = parseInteger(enrichedAccessor.get(enrichedRow, field), field, flags, { min: minimum })
      if (parsed === null) return
      targetRow[field] = parsed
      updatedFields.push(field)
    }

    const updateDecimalField = (
      field: 'batting_avg' | 'strike_rate' | 'economy' | 'consistency_score' | 'recent_form_score'
    ) => {
      const parsed = parseDecimal(enrichedAccessor.get(enrichedRow, field), field, flags)
      if (parsed === null) return
      targetRow[field] = parsed
      updatedFields.push(field)
    }

    updateIntegerField('matches', 0)
    updateDecimalField('batting_avg')
    updateDecimalField('strike_rate')
    updateIntegerField('wickets', 0)
    updateDecimalField('economy')
    updateIntegerField('performance_score', 0)
    updateDecimalField('consistency_score')
    updateDecimalField('recent_form_score')

    for (const field of ['experience_level', 'impact_type'] as const) {
      const value = enrichedAccessor.get(enrichedRow, field).trim()
      if (!value) continue
      targetRow[field] = value
      updatedFields.push(field)
    }

    const auditEntry: UpdatedRowAudit = {
      id: targetRow.id,
      name: targetRow.name,
      normalized_name: normalizedName,
      db_role: targetRow.role,
      enriched_role: enrichedRoleCode,
      updated_fields: updatedFields,
      flags
    }

    updatedRowsAudit.push(auditEntry)
    rowAuditById.set(targetRow.id, auditEntry)
  }

  const finalValidationOnly: Array<{ id: string; name: string; flags: Flag[] }> = []
  for (const row of outputRows) {
    const flags: Flag[] = []
    addOutlierFlags(row, flags)

    if (flags.length === 0) continue

    const existingAudit = rowAuditById.get(row.id)
    if (existingAudit) {
      existingAudit.flags.push(...flags)
    } else {
      finalValidationOnly.push({
        id: row.id,
        name: row.name,
        flags
      })
    }
  }

  const ids = outputRows.map((row) => row.id)
  const uniqueIds = new Set(ids)
  if (ids.length !== uniqueIds.size) {
    throw new Error('Final output contains duplicate ids')
  }

  if (outputRows.length !== dbParsed.rows.length) {
    throw new Error('Final output row count does not match the DB export row count')
  }

  const csvRows = [outputHeader, ...outputRows.map((row) => outputHeader.map((column) => row[column] ?? ''))]
  const importCsvPath = path.join(args.outDir, 'players_merged_for_import.csv')
  const auditPath = path.join(args.outDir, 'players_merge_audit.json')

  const summary = {
    db_rows: dbParsed.rows.length,
    enriched_rows: enrichedParsed.rows.length,
    output_rows: outputRows.length,
    exact_name_unique_matches: updatedRowsAudit.length + skippedUpdates.filter((item) => item.reason === 'role_mismatch').length,
    updated_rows: updatedRowsAudit.length,
    skipped_ambiguous_name: skippedUpdates.filter((item) => item.reason === 'ambiguous_name').length,
    skipped_role_mismatch: skippedUpdates.filter((item) => item.reason === 'role_mismatch').length,
    quarantined_enriched_only: quarantinedRows.length,
    final_validation_only_rows: finalValidationOnly.length,
    outlier_flags: [...updatedRowsAudit.flatMap((row) => row.flags), ...finalValidationOnly.flatMap((row) => row.flags)].filter(
      (flag) => flag.type === 'outlier'
    ).length,
    invalid_numeric_flags: [...updatedRowsAudit.flatMap((row) => row.flags), ...finalValidationOnly.flatMap((row) => row.flags)].filter(
      (flag) => flag.type === 'invalid_numeric'
    ).length,
    nationality_not_validated_flags: updatedRowsAudit.flatMap((row) => row.flags).filter(
      (flag) => flag.type === 'nationality_not_validated'
    ).length
  }

  const auditReport = {
    generated_at: new Date().toISOString(),
    inputs: {
      db_csv: args.db,
      enriched_csv: args.enriched
    },
    outputs: {
      import_csv: importCsvPath,
      audit_report: auditPath
    },
    schema: {
      output_columns: outputHeader
    },
    summary,
    skipped_updates: skippedUpdates,
    quarantined_enriched_rows: quarantinedRows,
    updated_rows: updatedRowsAudit,
    final_validation_only_rows: finalValidationOnly
  }

  await writeFile(importCsvPath, `${stringifyCsv(csvRows)}\n`, 'utf8')
  await writeFile(auditPath, `${JSON.stringify(auditReport, null, 2)}\n`, 'utf8')

  console.log(`Wrote import CSV: ${importCsvPath}`)
  console.log(`Wrote audit report: ${auditPath}`)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

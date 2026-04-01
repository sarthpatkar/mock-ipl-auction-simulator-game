import { NextResponse } from 'next/server'
import { requireServiceRole, getAuthenticatedApiUser, isMatchResultsAdmin } from '@/lib/server-auth'
import { buildScorecardContentHash, parseScorecardWithFallback } from '@/lib/scorecard-parser'
import { Match, Player } from '@/types'

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedApiUser(request)
    if (!user || !isMatchResultsAdmin(user.id)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const matchId = String(body?.matchId ?? '')
    const rawScorecardText = String(body?.rawScorecardText ?? '').trim()

    if (!matchId || !rawScorecardText) {
      return NextResponse.json({ error: 'matchId and rawScorecardText are required' }, { status: 400 })
    }

    const service = requireServiceRole()
    const { data: matchRow, error: matchError } = await service
      .from('matches')
      .select('id, season, match_slug, team_a_code, team_b_code, team_a_name, team_b_name, match_date, venue, status, external_match_id, auction_enabled, last_scorecard_upload_at')
      .eq('id', matchId)
      .maybeSingle()

    if (matchError) throw matchError
    if (!matchRow) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }

    const match = matchRow as Match
    const { data: players, error: playersError } = await service
      .from('players')
      .select('id, name, team_code, role, performance_score, recent_form_score, consistency_score')
      .in('team_code', [match.team_a_code, match.team_b_code])

    if (playersError) throw playersError

    const { data: latestScorecard } = await service
      .from('raw_match_scorecards')
      .select('scorecard_version')
      .eq('match_id', matchId)
      .order('scorecard_version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const parsed = await parseScorecardWithFallback(rawScorecardText, match, ((players as unknown) as Player[] | null) ?? [])
    const contentHash = buildScorecardContentHash(rawScorecardText)
    const scorecardVersion = Number(latestScorecard?.scorecard_version ?? 0) + 1

    const { data: scorecardRecord, error: scorecardError } = await service
      .from('raw_match_scorecards')
      .insert({
        match_id: matchId,
        raw_scorecard_text: rawScorecardText,
        uploaded_by: user.id,
        parsing_status: parsed.provider ? 'parsed' : 'manual_review',
        provider: parsed.provider,
        model: parsed.model,
        raw_ai_response: parsed.rawAiResponse,
        normalized_parsed_json: parsed.payload,
        content_hash: contentHash,
        scorecard_version: scorecardVersion
      })
      .select('id, scorecard_version')
      .maybeSingle()

    if (scorecardError) throw scorecardError

    await service.from('matches').update({ last_scorecard_upload_at: new Date().toISOString() }).eq('id', matchId)

    await service.from('match_scorecard_audit_logs').insert({
      match_id: matchId,
      scorecard_id: scorecardRecord?.id ?? null,
      action_type: 'parsed',
      acted_by: user.id,
      manual_row_change_count: 0,
      metadata_json: {
        provider: parsed.provider,
        model: parsed.model,
        row_count: parsed.payload.rows.length,
        unresolved_count: parsed.payload.unresolved_rows.length,
        diagnostics: parsed.diagnostics
      }
    })

    return NextResponse.json({
      scorecardId: scorecardRecord?.id ?? null,
      scorecardVersion: scorecardRecord?.scorecard_version ?? scorecardVersion,
      provider: parsed.provider,
      model: parsed.model,
      payload: parsed.payload,
      diagnostics: parsed.diagnostics
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to parse scorecard' }, { status: 500 })
  }
}

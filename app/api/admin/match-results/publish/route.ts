import { NextResponse } from 'next/server'
import { getAuthenticatedApiUser, isMatchResultsAdmin, requireServiceRole } from '@/lib/server-auth'
import { ParsedMatchStatRow, materializePublishedRows, validateParsedScorecardPayload } from '@/lib/scorecard-parser'
import { Match, MatchAuctionResult, Player, RoomParticipant, SquadPlayer } from '@/types'

type ExistingRoomResult = MatchAuctionResult & { room_id: string; user_id: string }

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedApiUser(request)
    if (!user || !isMatchResultsAdmin(user.id)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const matchId = String(body?.matchId ?? '')
    const scorecardId = String(body?.scorecardId ?? '')
    const rows = Array.isArray(body?.rows) ? (body.rows as ParsedMatchStatRow[]) : []
    const manualRowChangeCount = Number(body?.manualRowChangeCount ?? 0)

    if (!matchId || !scorecardId) {
      return NextResponse.json({ error: 'matchId and scorecardId are required' }, { status: 400 })
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
      .select('id, name, team_code, role')
      .in('team_code', [match.team_a_code, match.team_b_code])

    if (playersError) throw playersError

    const validated = validateParsedScorecardPayload(
      {
        match_id: matchId,
        rows,
        unresolved_rows: []
      },
      ((players as unknown) as Player[] | null) ?? [],
      match
    )

    const publishedRows = materializePublishedRows(validated.rows)

    await service.from('match_player_stats').delete().eq('match_id', matchId)
    if (publishedRows.length > 0) {
      const { error: upsertError } = await service.from('match_player_stats').upsert(
        publishedRows.map((row) => ({
          match_id: matchId,
          player_id: row.player_id,
          player_name_snapshot: row.player_name_snapshot,
          source_player_name: row.source_player_name,
          team_code: row.team_code,
          did_play: row.did_play,
          is_playing_xi: row.is_playing_xi,
          is_substitute: row.is_substitute,
          parse_confidence: row.parse_confidence,
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
          run_outs: row.run_outs,
          fantasy_points: row.fantasy_points,
          updated_at: new Date().toISOString()
        })),
        { onConflict: 'match_id,player_id' }
      )

      if (upsertError) throw upsertError
    }

    const { data: scorecardRow, error: scorecardError } = await service
      .from('raw_match_scorecards')
      .select('id, scorecard_version')
      .eq('id', scorecardId)
      .eq('match_id', matchId)
      .maybeSingle()

    if (scorecardError) throw scorecardError
    if (!scorecardRow) {
      return NextResponse.json({ error: 'Scorecard record not found' }, { status: 404 })
    }

    const publishedStatsVersion = Number(scorecardRow.scorecard_version)

    const { data: rooms, error: roomsError } = await service
      .from('rooms')
      .select('id')
      .eq('auction_mode', 'match_auction')
      .eq('match_id', matchId)

    if (roomsError) throw roomsError
    const roomIds = (((rooms as unknown) as Array<{ id: string }> | null) ?? []).map((room) => room.id)

    if (roomIds.length === 0) {
      await service
        .from('raw_match_scorecards')
        .update({
          parsing_status: 'published',
          normalized_parsed_json: validated,
          published_at: new Date().toISOString(),
          published_by: user.id
        })
        .eq('id', scorecardId)

      return NextResponse.json({
        success: true,
        publishedStatsVersion,
        publishedRoomCount: 0
      })
    }

    await Promise.all(roomIds.map((roomId) => service.rpc('refresh_match_auction_provisional_results', { p_room_id: roomId })))

    const [{ data: participantRows, error: participantsError }, { data: squadRows, error: squadsError }, { data: existingResults, error: resultsError }] =
      await Promise.all([
        service
          .from('room_participants')
          .select('id, room_id, user_id, team_name, budget_remaining, squad_count, joined_at, match_finish_confirmed_at')
          .in('room_id', roomIds)
          .is('removed_at', null),
        service.from('squad_players').select('id, room_id, participant_id, player_id, price_paid, acquired_at').in('room_id', roomIds),
        service.from('match_auction_results').select('room_id, user_id, projected_score, actual_score, result_status, rank, winner_user_id, last_updated_at, last_result_updated_at, published_stats_version').in('room_id', roomIds)
      ])

    if (participantsError) throw participantsError
    if (squadsError) throw squadsError
    if (resultsError) throw resultsError

    const pointsByPlayerId = publishedRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.player_id] = row.fantasy_points
      return acc
    }, {})

    const participantList = ((participantRows as unknown) as RoomParticipant[] | null) ?? []
    const squadList = ((squadRows as unknown) as SquadPlayer[] | null) ?? []
    const priorResults = ((existingResults as unknown) as ExistingRoomResult[] | null) ?? []
    const priorResultsByRoomUser = priorResults.reduce<Record<string, ExistingRoomResult>>((acc, row) => {
      acc[`${row.room_id}:${row.user_id}`] = row
      return acc
    }, {})

    const upsertRows: Array<Record<string, unknown>> = []

    roomIds.forEach((roomId) => {
      const participants = participantList.filter((participant) => participant.room_id === roomId)

      if (match.status === 'abandoned' || match.status === 'cancelled') {
        participants.forEach((participant) => {
          const previous = priorResultsByRoomUser[`${roomId}:${participant.user_id}`]
          upsertRows.push({
            room_id: roomId,
            user_id: participant.user_id,
            projected_score: Number(previous?.projected_score ?? 0),
            actual_score: null,
            result_status: 'match_abandoned',
            rank: null,
            winner_user_id: null,
            last_updated_at: new Date().toISOString(),
            last_result_updated_at: new Date().toISOString(),
            published_stats_version: publishedStatsVersion
          })
        })
        return
      }

      const scored = participants
        .map((participant) => {
          const squad = squadList.filter((entry) => entry.participant_id === participant.id)
          const actualScore = squad.reduce((total, entry) => total + (pointsByPlayerId[entry.player_id] ?? 0), 0)
          const previous = priorResultsByRoomUser[`${roomId}:${participant.user_id}`]
          return {
            participant,
            projectedScore: Number(previous?.projected_score ?? 0),
            actualScore
          }
        })
        .sort((left, right) => right.actualScore - left.actualScore || new Date(left.participant.joined_at).getTime() - new Date(right.participant.joined_at).getTime())

      const winnerUserId = scored[0]?.participant.user_id ?? null

      scored.forEach((entry, index) => {
        upsertRows.push({
          room_id: roomId,
          user_id: entry.participant.user_id,
          projected_score: entry.projectedScore,
          actual_score: entry.actualScore,
          result_status: 'final_ready',
          rank: index + 1,
          winner_user_id: winnerUserId,
          last_updated_at: new Date().toISOString(),
          last_result_updated_at: new Date().toISOString(),
          published_stats_version: publishedStatsVersion
        })
      })
    })

    if (upsertRows.length > 0) {
      const { error: upsertResultsError } = await service.from('match_auction_results').upsert(upsertRows, { onConflict: 'room_id,user_id' })
      if (upsertResultsError) throw upsertResultsError
    }

    await service
      .from('raw_match_scorecards')
      .update({
        parsing_status: 'published',
        normalized_parsed_json: validated,
        published_at: new Date().toISOString(),
        published_by: user.id
      })
      .eq('id', scorecardId)

    await service.from('matches').update({ last_scorecard_upload_at: new Date().toISOString() }).eq('id', matchId)

    if (manualRowChangeCount > 0) {
      await service.from('match_scorecard_audit_logs').insert({
        match_id: matchId,
        scorecard_id: scorecardId,
        action_type: 'edited',
        acted_by: user.id,
        manual_row_change_count: manualRowChangeCount,
        metadata_json: {
          changed_rows: manualRowChangeCount
        }
      })
    }

    await service.from('match_scorecard_audit_logs').insert({
      match_id: matchId,
      scorecard_id: scorecardId,
      action_type: 'published',
      acted_by: user.id,
      manual_row_change_count: manualRowChangeCount,
      metadata_json: {
        published_stats_version: publishedStatsVersion,
        row_count: publishedRows.length,
        room_count: roomIds.length
      }
    })

    return NextResponse.json({
      success: true,
      publishedStatsVersion,
      publishedRoomCount: roomIds.length
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to publish scorecard' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { getAuthenticatedApiUser, isMatchResultsAdmin, requireServiceRole } from '@/lib/server-auth'

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedApiUser(request)
    if (!user || !isMatchResultsAdmin(user.id)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const matchId = String(searchParams.get('matchId') ?? '')

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 })
    }

    const service = requireServiceRole()
    const [{ data: publishedScorecard, error: scorecardError }, { count: roomCount, error: roomCountError }] = await Promise.all([
      service
        .from('raw_match_scorecards')
        .select('id, scorecard_version, published_at')
        .eq('match_id', matchId)
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from('rooms')
        .select('id', { count: 'exact', head: true })
        .eq('auction_mode', 'match_auction')
        .eq('match_id', matchId)
    ])

    if (scorecardError) throw scorecardError
    if (roomCountError) throw roomCountError

    return NextResponse.json({
      hasPublishedVersion: Boolean(publishedScorecard?.published_at),
      scorecardId: publishedScorecard?.id ?? null,
      scorecardVersion: publishedScorecard?.scorecard_version ?? null,
      publishedAt: publishedScorecard?.published_at ?? null,
      publishedRoomCount: publishedScorecard?.published_at ? roomCount ?? 0 : null
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load publish status' }, { status: 500 })
  }
}

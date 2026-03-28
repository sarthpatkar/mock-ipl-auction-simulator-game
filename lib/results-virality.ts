import { formatPrice } from '@/lib/auction-helpers'
import { Player, RoomParticipant, SquadPlayer, TeamResult, TeamResultBreakdown } from '@/types'

const CR = 10_000_000
const MIN_PRICE_CR = 0.25
const STAR_THRESHOLD = 85

export type ResultsPurchase = {
  row: SquadPlayer
  player: Player
  pricePaid: number
  pricePaidCr: number
  basePrice: number
  priceDelta: number
  performance: number
  qualityScore: number
  valueIndex: number
}

export type ResultsDerivedTeam = {
  participant: RoomParticipant | null
  result: TeamResult
  breakdown: TeamResultBreakdown
  purchases: ResultsPurchase[]
  squad: Player[]
  isMine: boolean
  totalSpend: number
  totalSpendCr: number
  remainingPurse: number
  starCount: number
  averageRating: number
  battingStrength: number
  bowlingStrength: number
  smartestBuyerScore: number
  riskScore: number
  mostExpensivePurchase: ResultsPurchase | null
}

export type AwardBadgeModel = {
  id: string
  title: string
  strapline: string
  team: ResultsDerivedTeam
  valueLabel: string
  supportingCopy: string
}

export type PurchaseSpotlightModel = {
  id: 'most-expensive' | 'worst-buy' | 'best-value'
  title: string
  strapline: string
  purchase: ResultsPurchase
  team: ResultsDerivedTeam
  supportingCopy: string
}

export type ComparisonMetricModel = {
  id: string
  label: string
  leftValue: string
  rightValue: string
  winner: 'left' | 'right' | 'tie'
}

export type TeamComparisonModel = {
  left: ResultsDerivedTeam
  right: ResultsDerivedTeam
  metrics: ComparisonMetricModel[]
  leftWins: number
  rightWins: number
  overallWinner: 'left' | 'right' | 'tie'
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits))
}

function formatScore(value: number) {
  return value.toFixed(2)
}

function formatMetric(value: number, digits = 1) {
  return value.toFixed(digits).replace(/\.0+$/, '')
}

function safeAverage(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function getPerformance(player: Player) {
  return player.performance_score ?? 60
}

function getQualityScore(player: Player) {
  return getPerformance(player) + (player.recent_form_score ?? 0) * 0.35 + (player.consistency_score ?? 0) * 0.25
}

function computeBattingContribution(player: Player) {
  const base = getPerformance(player) * 0.72 + (player.batting_avg ?? 0) * 0.55 + (player.strike_rate ?? 0) * 0.18
  if (player.role === 'batter') return base
  if (player.role === 'wicketkeeper') return base * 0.96
  if (player.role === 'allrounder') return base * 0.82
  return base * 0.18
}

function computeBowlingContribution(player: Player) {
  const base = getPerformance(player) * 0.72 + (player.wickets ?? 0) * 1.8 + Math.max(0, 12 - (player.economy ?? 12)) * 5.5
  if (player.role === 'bowler') return base
  if (player.role === 'allrounder') return base * 0.86
  return base * 0.18
}

function buildPurchase(player: Player, row: SquadPlayer): ResultsPurchase {
  const pricePaidCr = Math.max(row.price_paid / CR, MIN_PRICE_CR)
  const qualityScore = getQualityScore(player)
  return {
    row,
    player,
    pricePaid: row.price_paid,
    pricePaidCr,
    basePrice: player.base_price ?? 0,
    priceDelta: Math.max(0, row.price_paid - (player.base_price ?? 0)),
    performance: getPerformance(player),
    qualityScore,
    valueIndex: qualityScore / pricePaidCr
  }
}

export function buildResultsTeams({
  participants,
  results,
  squads,
  playersById,
  currentUserId
}: {
  participants: RoomParticipant[]
  results: TeamResult[]
  squads: SquadPlayer[]
  playersById: Record<string, Player>
  currentUserId?: string | null
}) {
  const participantByUserId = participants.reduce<Record<string, RoomParticipant>>((acc, participant) => {
    acc[participant.user_id] = participant
    return acc
  }, {})

  const squadsByParticipantId = squads.reduce<Record<string, SquadPlayer[]>>((acc, squadPlayer) => {
    acc[squadPlayer.participant_id] = [...(acc[squadPlayer.participant_id] ?? []), squadPlayer]
    return acc
  }, {})

  return results.map<ResultsDerivedTeam>((result) => {
    const participant = participantByUserId[result.user_id] ?? null
    const squadRows = participant ? squadsByParticipantId[participant.id] ?? [] : []
    const purchases = squadRows
      .map((row) => {
        const player = playersById[row.player_id]
        return player ? buildPurchase(player, row) : null
      })
      .filter((purchase): purchase is ResultsPurchase => Boolean(purchase))
      .sort((left, right) => {
        if (right.performance !== left.performance) return right.performance - left.performance
        return right.pricePaid - left.pricePaid
      })

    const totalSpend = purchases.reduce((sum, purchase) => sum + purchase.pricePaid, 0)
    const totalSpendCr = Math.max(totalSpend / CR, MIN_PRICE_CR)
    const riskPremium = [...purchases].sort((left, right) => right.pricePaid - left.pricePaid).slice(0, 3)
    const topSpend = riskPremium.reduce((sum, purchase) => sum + purchase.pricePaid, 0)
    const concentration = totalSpend > 0 ? topSpend / totalSpend : 0
    const weakValueDrag = safeAverage(riskPremium.map((purchase) => 120 / Math.max(purchase.valueIndex, 1)))
    const spendDeltaPressure = riskPremium.reduce((sum, purchase) => sum + purchase.priceDelta / CR, 0)

    return {
      participant,
      result,
      breakdown: result.breakdown_json,
      purchases,
      squad: purchases.map((purchase) => purchase.player),
      isMine: result.user_id === currentUserId,
      totalSpend,
      totalSpendCr,
      remainingPurse: participant?.budget_remaining ?? 0,
      starCount: purchases.filter((purchase) => purchase.performance >= STAR_THRESHOLD).length,
      averageRating: safeAverage(purchases.map((purchase) => purchase.performance)),
      battingStrength: round(purchases.reduce((sum, purchase) => sum + computeBattingContribution(purchase.player), 0)),
      bowlingStrength: round(purchases.reduce((sum, purchase) => sum + computeBowlingContribution(purchase.player), 0)),
      smartestBuyerScore: round(purchases.reduce((sum, purchase) => sum + purchase.performance, 0) / totalSpendCr),
      riskScore: round(concentration * 100 + weakValueDrag + spendDeltaPressure * 1.8),
      mostExpensivePurchase: [...purchases].sort((left, right) => right.pricePaid - left.pricePaid)[0] ?? null
    }
  })
}

function getOwnerName(team: ResultsDerivedTeam) {
  return team.participant?.profiles?.username || 'Franchise Owner'
}

function getTeamName(team: ResultsDerivedTeam) {
  return team.participant?.team_name || 'Franchise'
}

function selectTopTeam(teams: ResultsDerivedTeam[], getValue: (team: ResultsDerivedTeam) => number) {
  return [...teams].sort((left, right) => {
    const rightValue = getValue(right)
    const leftValue = getValue(left)
    if (rightValue !== leftValue) return rightValue - leftValue
    return left.result.rank - right.result.rank
  })[0] ?? null
}

export function deriveAwardBadges(teams: ResultsDerivedTeam[]): AwardBadgeModel[] {
  const winner = [...teams].sort((left, right) => left.result.rank - right.result.rank)[0] ?? null
  const bestSquad = selectTopTeam(teams, (team) => team.breakdown.components.player_strength.score)
  const smartestBuyer = selectTopTeam(teams, (team) => team.smartestBuyerScore)
  const bestBowling = selectTopTeam(teams, (team) => team.bowlingStrength)
  const bestBatting = selectTopTeam(teams, (team) => team.battingStrength)
  const biggestRisk = selectTopTeam(teams, (team) => team.riskScore)

  return [
    winner && {
      id: 'auction-winner',
      title: 'Auction Winner',
      strapline: 'Finished on top when the final rankings dropped',
      team: winner,
      valueLabel: `Score ${formatScore(winner.result.team_score)}`,
      supportingCopy: `${getTeamName(winner)} finished #1 with ${getOwnerName(winner)} in charge.`
    },
    bestSquad && {
      id: 'best-squad',
      title: 'Best Squad',
      strapline: 'The strongest all-round squad on the board',
      team: bestSquad,
      valueLabel: `${formatScore(bestSquad.breakdown.components.player_strength.score)} player strength`,
      supportingCopy: `${getTeamName(bestSquad)} stacked the deepest overall talent core.`
    },
    smartestBuyer && {
      id: 'smartest-buyer',
      title: 'Smartest Buyer',
      strapline: 'Most quality packed into every crore spent',
      team: smartestBuyer,
      valueLabel: `${formatMetric(smartestBuyer.smartestBuyerScore)} efficiency`,
      supportingCopy: `${getTeamName(smartestBuyer)} squeezed rating value out of the purse better than anyone else.`
    },
    bestBowling && {
      id: 'best-bowling',
      title: 'Best Bowling Unit',
      strapline: 'Built the nastiest attack in the room',
      team: bestBowling,
      valueLabel: `${formatMetric(bestBowling.bowlingStrength)} bowling score`,
      supportingCopy: `${getTeamName(bestBowling)} built the most threatening wicket-taking and economy profile.`
    },
    bestBatting && {
      id: 'best-batting',
      title: 'Best Batting Unit',
      strapline: 'Loaded the room’s most dangerous batting core',
      team: bestBatting,
      valueLabel: `${formatMetric(bestBatting.battingStrength)} batting score`,
      supportingCopy: `${getTeamName(bestBatting)} brought the strongest batting volume, average, and intent.`
    },
    biggestRisk && {
      id: 'biggest-risk',
      title: 'Biggest Risk Taker',
      strapline: 'Went hardest when the auction heat peaked',
      team: biggestRisk,
      valueLabel: `${formatMetric(biggestRisk.riskScore)} risk score`,
      supportingCopy: `${getTeamName(biggestRisk)} pushed the purse hardest on high-pressure swings.`
    }
  ].filter((value): value is AwardBadgeModel => Boolean(value))
}

export function derivePurchaseSpotlights(teams: ResultsDerivedTeam[]): PurchaseSpotlightModel[] {
  const purchases = teams.flatMap((team) => team.purchases.map((purchase) => ({ purchase, team })))
  if (purchases.length === 0) return []

  const mostExpensive = [...purchases].sort((left, right) => {
    if (right.purchase.pricePaid !== left.purchase.pricePaid) return right.purchase.pricePaid - left.purchase.pricePaid
    return right.purchase.priceDelta - left.purchase.priceDelta
  })[0]

  const worstBuy = [...purchases].sort((left, right) => {
    if (left.purchase.valueIndex !== right.purchase.valueIndex) return left.purchase.valueIndex - right.purchase.valueIndex
    return right.purchase.priceDelta - left.purchase.priceDelta
  })[0]

  const bestValue = [...purchases].sort((left, right) => {
    if (right.purchase.valueIndex !== left.purchase.valueIndex) return right.purchase.valueIndex - left.purchase.valueIndex
    return right.purchase.performance - left.purchase.performance
  })[0]

  return [
    {
      id: 'most-expensive',
      title: 'Most Expensive Buy',
      strapline: 'The room-defining marquee purchase',
      purchase: mostExpensive.purchase,
      team: mostExpensive.team,
      supportingCopy: `${getTeamName(mostExpensive.team)} pushed ${formatPrice(mostExpensive.purchase.priceDelta)} above base to land ${mostExpensive.purchase.player.name}.`
    },
    {
      id: 'worst-buy',
      title: 'Worst Buy',
      strapline: 'The buy that stretched the purse the most',
      purchase: worstBuy.purchase,
      team: worstBuy.team,
      supportingCopy: `${getTeamName(worstBuy.team)} paid ${formatPrice(worstBuy.purchase.pricePaid)} for a value index of ${formatMetric(worstBuy.purchase.valueIndex)}.`
    },
    {
      id: 'best-value',
      title: 'Steal of the Auction',
      strapline: 'Elite quality for the least spend pressure',
      purchase: bestValue.purchase,
      team: bestValue.team,
      supportingCopy: `${bestValue.purchase.player.name} delivered ${formatMetric(bestValue.purchase.valueIndex)} value index at just ${formatPrice(bestValue.purchase.pricePaid)}.`
    }
  ]
}

function resolveMetricWinner(left: number, right: number): 'left' | 'right' | 'tie' {
  if (Math.abs(left - right) < 0.001) return 'tie'
  return left > right ? 'left' : 'right'
}

export function buildTeamComparison(left: ResultsDerivedTeam, right: ResultsDerivedTeam): TeamComparisonModel {
  const metrics: ComparisonMetricModel[] = [
    {
      id: 'batting',
      label: 'Batting Strength',
      leftValue: formatMetric(left.battingStrength),
      rightValue: formatMetric(right.battingStrength),
      winner: resolveMetricWinner(left.battingStrength, right.battingStrength)
    },
    {
      id: 'bowling',
      label: 'Bowling Strength',
      leftValue: formatMetric(left.bowlingStrength),
      rightValue: formatMetric(right.bowlingStrength),
      winner: resolveMetricWinner(left.bowlingStrength, right.bowlingStrength)
    },
    {
      id: 'purse',
      label: 'Remaining Purse',
      leftValue: formatPrice(left.remainingPurse),
      rightValue: formatPrice(right.remainingPurse),
      winner: resolveMetricWinner(left.remainingPurse, right.remainingPurse)
    },
    {
      id: 'stars',
      label: 'Star Players',
      leftValue: String(left.starCount),
      rightValue: String(right.starCount),
      winner: resolveMetricWinner(left.starCount, right.starCount)
    },
    {
      id: 'rating',
      label: 'Average Player Rating',
      leftValue: formatMetric(left.averageRating),
      rightValue: formatMetric(right.averageRating),
      winner: resolveMetricWinner(left.averageRating, right.averageRating)
    },
    {
      id: 'balance',
      label: 'Squad Balance',
      leftValue: formatScore(left.breakdown.components.team_balance.score),
      rightValue: formatScore(right.breakdown.components.team_balance.score),
      winner: resolveMetricWinner(left.breakdown.components.team_balance.score, right.breakdown.components.team_balance.score)
    }
  ]

  const leftWins = metrics.filter((metric) => metric.winner === 'left').length
  const rightWins = metrics.filter((metric) => metric.winner === 'right').length

  return {
    left,
    right,
    metrics,
    leftWins,
    rightWins,
    overallWinner: leftWins === rightWins ? 'tie' : leftWins > rightWins ? 'left' : 'right'
  }
}

export function getInviteText(roomName: string, roomCode: string, appOrigin: string) {
  return `Think you can build a better team next time?\n\nJoin my IPL Auction room${roomName ? `: ${roomName}` : ''}\nRoom code: ${roomCode}\n${appOrigin}/room/join`
}

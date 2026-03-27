import { Player } from '@/types'

function shuffle<T>(items: T[]): T[] {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

// Category mode order: Batters → Bowlers → All-rounders → Wicketkeepers
// Within each category: fully shuffled
export function buildCategoryQueue(players: Player[]): string[] {
  const order: Player['role'][] = ['batter', 'bowler', 'allrounder', 'wicketkeeper']
  const result: string[] = []

  for (const role of order) {
    result.push(...shuffle(players.filter((p) => p.role === role)).map((p) => p.id))
  }

  return result
}

export function buildRandomQueue(players: Player[]): string[] {
  return shuffle(players).map((p) => p.id)
}

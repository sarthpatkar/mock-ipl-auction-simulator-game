type ProjectionEntry = {
  id: string
  finalRank: number
}

type ProjectionPhase = 'initial' | 'active' | 'slow'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sampleWeightedIndex(weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return 0

  let threshold = Math.random() * total
  for (let index = 0; index < weights.length; index += 1) {
    threshold -= weights[index]
    if (threshold <= 0) return index
  }

  return weights.length - 1
}

function range(start: number, end: number) {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index)
}

function swapEntries<T>(list: T[], leftIndex: number, rightIndex: number) {
  const next = [...list]
  const temp = next[leftIndex]
  next[leftIndex] = next[rightIndex]
  next[rightIndex] = temp
  return next
}

function projectionBand(finalIndex: number, total: number, phase: ProjectionPhase) {
  if (total <= 1) return { min: 0, max: 0 }

  const upperHalfMax = Math.max(0, Math.floor((total - 1) / 2))
  const lowerHalfMin = Math.min(total - 1, Math.ceil(total / 2))

  if (phase === 'slow') {
    if (finalIndex === 0) return { min: 0, max: Math.min(total - 1, 1) }
    if (finalIndex < 3) return { min: 0, max: Math.min(total - 1, 2) }
    if (finalIndex >= total - 1) return { min: Math.max(lowerHalfMin, total - 2), max: total - 1 }
    if (finalIndex >= total - 2) return { min: Math.max(lowerHalfMin, total - 3), max: total - 1 }
    return { min: clamp(finalIndex - 1, 0, total - 1), max: clamp(finalIndex + 1, 0, total - 1) }
  }

  if (finalIndex === 0) return { min: 0, max: Math.min(total - 1, Math.max(1, upperHalfMax)) }
  if (finalIndex < 3) return { min: 0, max: Math.min(total - 1, Math.max(2, upperHalfMax)) }
  if (finalIndex >= total - 1) return { min: Math.max(lowerHalfMin, total - 2), max: total - 1 }
  if (finalIndex >= total - 2) return { min: Math.max(lowerHalfMin, total - 3), max: total - 1 }
  if (phase === 'initial') {
    return { min: clamp(finalIndex - 2, 0, total - 1), max: clamp(finalIndex + 2, 0, total - 1) }
  }
  return { min: clamp(finalIndex - 2, 0, total - 1), max: clamp(finalIndex + 2, 0, total - 1) }
}

function repairProjectionOrder<T extends ProjectionEntry>(list: T[], phase: ProjectionPhase) {
  let next = [...list]

  for (let pass = 0; pass < 3; pass += 1) {
    for (const entry of list) {
      const currentIndex = next.findIndex((item) => item.id === entry.id)
      if (currentIndex === -1) continue

      const band = projectionBand(entry.finalRank - 1, next.length, phase)
      if (currentIndex < band.min) {
        next = swapEntries(next, currentIndex, band.min)
      } else if (currentIndex > band.max) {
        next = swapEntries(next, currentIndex, band.max)
      }
    }
  }

  return next
}

function canPlaceEntry<T extends ProjectionEntry>(entry: T, index: number, total: number, phase: ProjectionPhase) {
  const band = projectionBand(entry.finalRank - 1, total, phase)
  return index >= band.min && index <= band.max
}

function chooseInitialTarget(finalIndex: number, total: number) {
  const band = projectionBand(finalIndex, total, 'initial')
  const slots = range(band.min, band.max)
  if (slots.length === 0) return finalIndex

  const withoutExact = slots.filter((slot) => slot !== finalIndex)
  const pool = withoutExact.length > 0 && Math.random() < 0.78 ? withoutExact : slots
  const weighted = pool
    .map((slot) => ({
      slot,
      weight: Math.max(1, Math.abs(slot - finalIndex)) + (slot === finalIndex ? 0.2 : 0.8)
    }))
    .sort((left, right) => right.weight - left.weight)

  const pickPool = weighted.slice(0, Math.max(1, Math.ceil(weighted.length / 2)))
  return pickPool[randomInt(0, pickPool.length - 1)].slot
}

function chooseCandidateIndex(total: number, phase: 'active' | 'slow') {
  const center = (total - 1) / 2
  const weights = Array.from({ length: total }, (_, index) => {
    if (phase === 'slow') {
      if (index < 3) return 1.8
      if (index === total - 1) return 0.2
      if (index >= total - 2) return 0.45
      return 0.85
    }

    const centerDistance = Math.abs(index - center)
    const centerBoost = 1.45 - Math.min(1, centerDistance / Math.max(1, total / 2))
    if (index === 0 || index === total - 1) return 0.25
    return Math.max(0.4, centerBoost)
  })

  return sampleWeightedIndex(weights)
}

export function generateInitialProjectedLeaderboard<T extends ProjectionEntry>(finalLeaderboard: T[]) {
  if (finalLeaderboard.length <= 1) return [...finalLeaderboard]

  const decorated = finalLeaderboard.map((entry, index) => ({
    entry,
    target: chooseInitialTarget(index, finalLeaderboard.length),
    noise: Math.random()
  }))

  let projected = decorated
    .sort((left, right) => {
      if (left.target !== right.target) return left.target - right.target
      return left.noise - right.noise
    })
    .map((item) => item.entry)

  projected = repairProjectionOrder(projected, 'initial')

  const unchanged = projected.every((entry, index) => entry.id === finalLeaderboard[index]?.id)
  if (unchanged && projected.length > 2) {
    const middleIndex = Math.floor(projected.length / 2)
    projected = swapEntries(projected, middleIndex - 1, middleIndex)
    projected = repairProjectionOrder(projected, 'initial')
  }

  return projected
}

export function applyProjectedLeaderboardTick<T extends ProjectionEntry>(
  animatedLeaderboard: T[],
  finalLeaderboard: T[],
  phase: 'active' | 'slow'
) {
  if (animatedLeaderboard.length <= 1) return [...animatedLeaderboard]

  let next = [...animatedLeaderboard]
  const total = next.length
  const attempts = phase === 'active' ? 16 : 20
  const maxMoves = phase === 'active' && total > 5 && Math.random() < 0.2 ? 2 : 1
  let moves = 0

  for (let attempt = 0; attempt < attempts && moves < maxMoves; attempt += 1) {
    const sourceIndex = chooseCandidateIndex(total, phase)
    const source = next[sourceIndex]
    if (!source) continue

    const directionOptions = Math.random() < 0.5 ? [-1, 1] : [1, -1]
    const allowTwoStep = phase === 'active' && total > 5 && sourceIndex > 1 && sourceIndex < total - 2 && Math.random() < 0.16
    const step = allowTwoStep ? 2 : 1

    let applied = false

    for (const direction of directionOptions) {
      const targetIndex = sourceIndex + direction * step
      if (targetIndex < 0 || targetIndex >= total) continue

      const swapped = swapEntries(next, sourceIndex, targetIndex)
      const sourceAfter = swapped.findIndex((item) => item.id === source.id)
      const displaced = next[targetIndex]
      const displacedAfter = displaced ? swapped.findIndex((item) => item.id === displaced.id) : -1

      if (!canPlaceEntry(source, sourceAfter, total, phase)) continue
      if (displaced && !canPlaceEntry(displaced, displacedAfter, total, phase)) continue

      const repaired = repairProjectionOrder(swapped, phase)
      if (repaired.every((entry, index) => canPlaceEntry(entry, index, total, phase))) {
        next = repaired
        applied = true
        moves += 1
        break
      }
    }

    if (!applied) continue
  }

  if (moves === 0) {
    return [...animatedLeaderboard]
  }

  const allIds = new Set(finalLeaderboard.map((entry) => entry.id))
  if (next.length !== finalLeaderboard.length || next.some((entry) => !allIds.has(entry.id))) {
    return [...animatedLeaderboard]
  }

  return next
}

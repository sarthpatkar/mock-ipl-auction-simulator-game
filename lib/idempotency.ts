export function createIdempotencyKey(prefix: string, scope?: string) {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return scope ? `${prefix}:${scope}:${randomPart}` : `${prefix}:${randomPart}`
}


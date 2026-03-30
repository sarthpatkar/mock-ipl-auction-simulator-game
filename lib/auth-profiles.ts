import { SupabaseClient, User } from '@supabase/supabase-js'
import { supabaseClient } from '@/lib/supabase'

function sanitizeUsername(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 24)
}

function buildGoogleUsernameCandidates(user: User) {
  const metadata = user.user_metadata ?? {}
  const displayName =
    typeof metadata.full_name === 'string'
      ? metadata.full_name
      : typeof metadata.name === 'string'
        ? metadata.name
        : typeof metadata.user_name === 'string'
          ? metadata.user_name
          : ''

  const emailLocalPart = typeof user.email === 'string' ? user.email.split('@')[0] : ''
  const baseCandidates = [displayName, emailLocalPart, `franchise_${user.id.slice(0, 8)}`]
    .map(sanitizeUsername)
    .filter(Boolean)

  const uniqueCandidates = Array.from(new Set(baseCandidates))
  const [primary] = uniqueCandidates
  const fallbackBase = primary || `franchise_${user.id.slice(0, 8)}`

  return [
    ...uniqueCandidates,
    `${fallbackBase}_${user.id.slice(0, 4)}`,
    `${fallbackBase}_${user.id.slice(0, 6)}`,
    `${fallbackBase}_${Date.now().toString().slice(-4)}`
  ]
}

function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message).toLowerCase() : ''
  return code === '23505' || message.includes('duplicate key')
}

function isPermittedProfileInsertFailure(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message).toLowerCase() : ''
  return message.includes('row-level security') || message.includes('new row violates')
}

export async function ensureUserProfile(user: User, client: SupabaseClient = supabaseClient) {
  const { data: existingProfile } = await client.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (existingProfile) return

  const candidates = buildGoogleUsernameCandidates(user)

  for (const candidate of candidates) {
    const { error } = await client.from('profiles').insert({
      id: user.id,
      username: candidate
    })

    if (!error) return
    if (isPermittedProfileInsertFailure(error)) return
    if (isDuplicateKeyError(error)) continue
    throw error
  }

  throw new Error('Failed to create profile for Google sign-in')
}

export async function ensureGoogleProfile(user: User, client: SupabaseClient = supabaseClient) {
  return ensureUserProfile(user, client)
}

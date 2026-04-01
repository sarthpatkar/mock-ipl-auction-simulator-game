import { createClient } from '@supabase/supabase-js'
import { getServiceSupabase } from '@/lib/supabase'
import { cookies } from 'next/headers'

export async function getAuthenticatedApiUser(request: Request) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return null
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const {
    data: { user },
    error
  } = await authClient.auth.getUser(token)

  if (error || !user) return null
  return user
}

function readChunkedCookieValue(cookieStore: Awaited<ReturnType<typeof cookies>>, baseName: string) {
  const direct = cookieStore.get(baseName)?.value
  if (direct) return direct

  const chunkPrefix = `${baseName}.`
  const chunked = cookieStore
    .getAll()
    .filter((cookie) => cookie.name.startsWith(chunkPrefix))
    .sort((left, right) => Number(left.name.slice(chunkPrefix.length)) - Number(right.name.slice(chunkPrefix.length)))

  if (!chunked.length) return null
  return chunked.map((cookie) => cookie.value).join('')
}

export async function getAuthenticatedPageUser() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  const cookieStore = await cookies()
  const authCookie = cookieStore
    .getAll()
    .find((cookie) => /^sb-[^-]+-auth-token(?:\.\d+)?$/.test(cookie.name) || /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name))

  if (!authCookie) {
    return null
  }

  const baseName = authCookie.name.replace(/\.\d+$/, '')
  const rawSession = readChunkedCookieValue(cookieStore, baseName)
  if (!rawSession) return null

  try {
    const parsed = JSON.parse(rawSession)
    const accessToken =
      typeof parsed?.access_token === 'string'
        ? parsed.access_token
        : Array.isArray(parsed) && typeof parsed[0] === 'string'
          ? parsed[0]
          : null

    if (!accessToken) return null

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const {
      data: { user },
      error
    } = await authClient.auth.getUser(accessToken)

    if (error || !user) return null
    return user
  } catch {
    return null
  }
}

export function isMatchResultsAdmin(userId: string) {
  const allowlist = process.env.MATCH_RESULTS_ADMIN_USER_IDS
  if (!allowlist) return false
  return allowlist
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(userId)
}

export function requireServiceRole() {
  const service = getServiceSupabase()
  if (!service) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for admin match-result actions')
  }
  return service
}

import { createClient, SupabaseClient, User } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const AUTH_COOKIE_CHUNK_SIZE = 3000

function createMissingEnvClient(): SupabaseClient {
  const message =
    'Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and restart Next.js.'

  return new Proxy(
    {},
    {
      get() {
        throw new Error(message)
      }
    }
  ) as SupabaseClient
}

export const supabaseClient: SupabaseClient =
  supabaseUrl && supabaseAnonKey
    ? getBrowserSupabaseClient()
    : createMissingEnvClient()

export const supabasePkceClient: SupabaseClient = supabaseClient

declare global {
  var __iplSupabaseClient__: SupabaseClient | undefined
  var __iplSupabaseCookieStorage__: ReturnType<typeof createBrowserCookieStorage> | undefined
}

function buildCookieAttributes(maxAgeSeconds = 60 * 60 * 24 * 30) {
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : ''
  return `Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`
}

function readCookie(name: string) {
  if (typeof document === 'undefined') return null
  const encodedName = encodeURIComponent(name)
  const pair = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${encodedName}=`))

  if (!pair) return null
  return decodeURIComponent(pair.slice(encodedName.length + 1))
}

function listChunkCookieNames(baseKey: string) {
  if (typeof document === 'undefined') return []
  const prefix = `${encodeURIComponent(baseKey)}.`

  return document.cookie
    .split('; ')
    .map((entry) => entry.split('=')[0] ?? '')
    .filter((name) => name.startsWith(prefix))
    .map((name) => decodeURIComponent(name))
    .sort((left, right) => Number(left.split('.').pop()) - Number(right.split('.').pop()))
}

function writeCookie(name: string, value: string, maxAgeSeconds = 60 * 60 * 24 * 30) {
  if (typeof document === 'undefined') return
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ${buildCookieAttributes(maxAgeSeconds)}`
}

function removeCookie(name: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${encodeURIComponent(name)}=; ${buildCookieAttributes(0)}`
}

function createBrowserCookieStorage() {
  return {
    getItem(key: string) {
      const direct = readCookie(key)
      if (direct !== null) return direct

      const chunkNames = listChunkCookieNames(key)
      if (chunkNames.length === 0) return null

      return chunkNames.map((name) => readCookie(name) ?? '').join('')
    },
    setItem(key: string, value: string) {
      this.removeItem(key)

      if (value.length <= AUTH_COOKIE_CHUNK_SIZE) {
        writeCookie(key, value)
        return
      }

      const chunkCount = Math.ceil(value.length / AUTH_COOKIE_CHUNK_SIZE)
      for (let index = 0; index < chunkCount; index += 1) {
        const start = index * AUTH_COOKIE_CHUNK_SIZE
        writeCookie(`${key}.${index}`, value.slice(start, start + AUTH_COOKIE_CHUNK_SIZE))
      }
    },
    removeItem(key: string) {
      removeCookie(key)
      listChunkCookieNames(key).forEach(removeCookie)
    }
  }
}

function getBrowserCookieStorage() {
  if (typeof window === 'undefined') return undefined
  if (!globalThis.__iplSupabaseCookieStorage__) {
    globalThis.__iplSupabaseCookieStorage__ = createBrowserCookieStorage()
  }
  return globalThis.__iplSupabaseCookieStorage__
}

function getBrowserSupabaseClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    return createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        flowType: 'pkce',
        detectSessionInUrl: false
      }
    })
  }

  if (!globalThis.__iplSupabaseClient__) {
    globalThis.__iplSupabaseClient__ = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        flowType: 'pkce',
        detectSessionInUrl: false,
        storage: getBrowserCookieStorage()
      }
    })
  }

  return globalThis.__iplSupabaseClient__
}

let browserUserPromise: Promise<User | null> | null = null

function isSupabaseLockError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Lock "') || message.includes('Lock broken by another request')
}

export async function getBrowserSessionUser(): Promise<User | null> {
  if (typeof window === 'undefined') {
    const {
      data: { session }
    } = await supabaseClient.auth.getSession()
    return session?.user ?? null
  }

  if (browserUserPromise) return browserUserPromise

  browserUserPromise = (async () => {
    try {
      const {
        data: { session },
        error
      } = await supabaseClient.auth.getSession()

      if (error) throw error
      return session?.user ?? null
    } catch (error) {
      if (isSupabaseLockError(error)) {
        // Multiple tabs can race on the auth token lock. Retry once after the winning request finishes.
        await new Promise((resolve) => setTimeout(resolve, 50))
        try {
          const {
            data: { session }
          } = await supabaseClient.auth.getSession()
          return session?.user ?? null
        } catch (retryError) {
          if (isSupabaseLockError(retryError)) return null
          throw retryError
        }
      }
      throw error
    } finally {
      browserUserPromise = null
    }
  })()

  return browserUserPromise
}

// Server-only helper for seeding or admin actions (never import in client components)
export function getServiceSupabase(): SupabaseClient | null {
  if (!supabaseServiceRoleKey || !supabaseUrl) return null
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

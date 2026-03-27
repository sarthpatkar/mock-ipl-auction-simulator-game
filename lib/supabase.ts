import { createClient, SupabaseClient, User } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

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

declare global {
  var __iplSupabaseClient__: SupabaseClient | undefined
}

function getBrowserSupabaseClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    return createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  }

  if (!globalThis.__iplSupabaseClient__) {
    globalThis.__iplSupabaseClient__ = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
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

'use client'

import { useEffect, useRef, useState } from 'react'

export function useTimer(endsAt: string | null, onExpire?: (endsAt: string) => void) {
  const [remaining, setRemaining] = useState(0)
  const expiredRef = useRef<string | null>(null)

  useEffect(() => {
    if (!endsAt) {
      setRemaining(0)
      return
    }

    const syncRemaining = () => {
      const diff = new Date(endsAt).getTime() - Date.now()
      const seconds = Math.max(0, Math.ceil(diff / 1000))
      setRemaining(seconds)

      if (seconds === 0 && expiredRef.current !== endsAt) {
        expiredRef.current = endsAt
        onExpire?.(endsAt)
      }

      return seconds
    }

    syncRemaining()

    const interval = setInterval(() => {
      const seconds = syncRemaining()
      if (seconds === 0) {
        clearInterval(interval)
      }
    }, 100)

    return () => clearInterval(interval)
  }, [endsAt, onExpire])

  return {
    remaining,
    isWarning: remaining <= 5 && remaining > 0,
    isDanger: remaining <= 3 && remaining > 0
  }
}

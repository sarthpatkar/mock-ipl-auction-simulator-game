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

    const interval = setInterval(() => {
      const diff = new Date(endsAt).getTime() - Date.now()
      const seconds = Math.max(0, Math.ceil(diff / 1000))
      setRemaining(seconds)

      if (seconds === 0) {
        clearInterval(interval)
        if (expiredRef.current !== endsAt) {
          expiredRef.current = endsAt
          onExpire?.(endsAt)
        }
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

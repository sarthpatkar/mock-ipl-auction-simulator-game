'use client'

import { useMemo } from 'react'
import { RealtimeStatus, useRoomRuntimeStore } from '@/lib/room-runtime-store'
import { isRealtimeUpgradeEnabledForRoom } from '@/lib/realtime-flags'
import { useLegacyRoom } from '@/hooks/useLegacyRoom'

type UseRoomOptions = {
  includeRemoved?: boolean
}

function useRoomWithRuntimeStore(roomId: string | null, options: UseRoomOptions = {}) {
  const rolloutEnabled = isRealtimeUpgradeEnabledForRoom(roomId)
  const runtime = useRoomRuntimeStore(roomId, rolloutEnabled)
  const legacy = useLegacyRoom(roomId, { ...options, enabled: !rolloutEnabled })
  const includeRemoved = options.includeRemoved ?? false

  const participants = useMemo(
    () => (includeRemoved ? runtime.participants : runtime.participants.filter((participant) => !participant.removed_at)),
    [includeRemoved, runtime.participants]
  )

  if (!rolloutEnabled) {
    return legacy
  }

  return {
    room: runtime.room,
    participants,
    setRoom: () => undefined,
    loading: runtime.loading,
    error: runtime.error,
    connectionState: runtime.connectionState as RealtimeStatus,
    refetch: runtime.refetch
  }
}

export function useRoom(roomId: string | null, options: UseRoomOptions = {}) {
  return useRoomWithRuntimeStore(roomId, options)
}

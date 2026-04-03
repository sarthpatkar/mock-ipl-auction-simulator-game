'use client'

import { useMemo } from 'react'
import { useRoomRuntimeStore, RealtimeStatus } from '@/lib/room-runtime-store'
import { isRealtimeUpgradeEnabledForRoom } from '@/lib/realtime-flags'
import { useLegacyAuction } from '@/hooks/useLegacyAuction'

export type { RealtimeStatus }

function useAuctionWithRuntimeStore(roomId: string | null) {
  const rolloutEnabled = isRealtimeUpgradeEnabledForRoom(roomId)
  const runtime = useRoomRuntimeStore(roomId, rolloutEnabled)
  const legacy = useLegacyAuction(roomId, { enabled: !rolloutEnabled })

  const participants = useMemo(() => runtime.participants.filter((participant) => !participant.removed_at), [runtime.participants])

  if (!rolloutEnabled) {
    return legacy
  }

  return {
    room: runtime.room,
    auction: runtime.auction,
    bidHistory: runtime.bidHistory,
    participants,
    squads: runtime.squads,
    loading: runtime.loading,
    error: runtime.error,
    connectionState: runtime.connectionState as RealtimeStatus,
    isStale: runtime.isStale,
    refetch: runtime.refetch
  }
}

export function useAuction(roomId: string | null) {
  return useAuctionWithRuntimeStore(roomId)
}

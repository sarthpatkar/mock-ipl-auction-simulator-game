function readBooleanFlag(name: string, fallback: boolean) {
  const value = process.env[name]
  if (value == null) return fallback

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function readStringFlag(name: string, fallback: string) {
  const value = process.env[name]
  return value == null || value.trim() === '' ? fallback : value.trim()
}

function readCsvFlag(name: string) {
  const value = process.env[name]
  if (!value) return new Set<string>()

  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
}

function readIntegerFlag(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stableRoomHash(value: string) {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash % 100
}

export const realtimeFeatureFlags = {
  newRoomStore: readBooleanFlag('NEXT_PUBLIC_FLAG_NEW_ROOM_STORE', false),
  replayRecovery: readBooleanFlag('NEXT_PUBLIC_FLAG_REPLAY_RECOVERY', true),
  cronFinalizeAdvance: readBooleanFlag('NEXT_PUBLIC_FLAG_CRON_FINALIZE_ADVANCE', true),
  roomBroadcastChannel: readBooleanFlag('NEXT_PUBLIC_FLAG_ROOM_BROADCAST_CHANNEL', false),
  roomCacheLayer: readBooleanFlag('NEXT_PUBLIC_FLAG_ROOM_CACHE_LAYER', true),
  rolloutStrategy: readStringFlag('NEXT_PUBLIC_REALTIME_ROLLOUT_STRATEGY', 'all'),
  internalRoomIds: readCsvFlag('NEXT_PUBLIC_REALTIME_INTERNAL_ROOM_IDS'),
  limitedRoomIds: readCsvFlag('NEXT_PUBLIC_REALTIME_LIMITED_ROOM_IDS'),
  limitedPercent: Math.max(0, Math.min(100, readIntegerFlag('NEXT_PUBLIC_REALTIME_LIMITED_PERCENT', 10)))
}

export function isRealtimeUpgradeEnabledForRoom(roomId: string | null) {
  if (!roomId || !realtimeFeatureFlags.newRoomStore) return false

  switch (realtimeFeatureFlags.rolloutStrategy) {
    case 'off':
      return false
    case 'internal':
      return realtimeFeatureFlags.internalRoomIds.has(roomId)
    case 'limited':
      if (realtimeFeatureFlags.internalRoomIds.has(roomId) || realtimeFeatureFlags.limitedRoomIds.has(roomId)) {
        return true
      }
      return stableRoomHash(roomId) < realtimeFeatureFlags.limitedPercent
    case 'all':
    default:
      return true
  }
}

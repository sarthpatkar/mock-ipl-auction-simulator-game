'use client'

import { useEffect, useState } from 'react'
import {
  LEGENDS_AUCTION_MODE,
  LEGENDS_ROOM_MINIMUM_PARTICIPANTS,
  LEGENDS_ROOM_PARTICIPANT_LIMIT,
  LEGENDS_ROOM_SQUAD_SIZE,
  MATCH_AUCTION_MODE,
  MATCH_ROOM_BUDGET_OPTIONS,
  MATCH_ROOM_MINIMUM_SQUAD_SIZE,
  MATCH_ROOM_SQUAD_OPTIONS,
  MATCH_ROOM_TIMER_SECONDS
} from '@/lib/match-auction'
import { createIdempotencyKey } from '@/lib/idempotency'
import { supabaseClient } from '@/lib/supabase'
import { AuctionMode, RoomSettings } from '@/types'

type Props = {
  roomId: string
  settings: RoomSettings
  auctionMode?: AuctionMode
}

export function AdminSettings({ roomId, settings, auctionMode = 'full_auction' }: Props) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const isMatchAuction = auctionMode === MATCH_AUCTION_MODE
  const isLegendsAuction = auctionMode === LEGENDS_AUCTION_MODE

  useEffect(() => {
    setForm(settings)
  }, [settings])

  return (
    <div className="settings-card">
      <div className="settings-title">Room Settings</div>

      <div className="setting-group">
        <div className="setting-label">Team Budget</div>
        <div className="option-group-vert">
          {(isMatchAuction ? MATCH_ROOM_BUDGET_OPTIONS.map((val) => val / 1_000_0000) : [100, 150, 200, 250]).map((val) => (
            <button
              key={val}
              className={`option-btn-vert ${form.budget === val * 1_000_0000 ? 'active' : ''}`}
              onClick={() => setForm((p) => ({ ...p, budget: val * 1_000_0000 }))}
              type="button"
            >
              ₹{val} Cr
            </button>
          ))}
        </div>
      </div>

      <div className="setting-group">
        <div className="setting-label">Squad Size</div>
        <div className="option-group-vert" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {(isMatchAuction ? MATCH_ROOM_SQUAD_OPTIONS : isLegendsAuction ? [LEGENDS_ROOM_SQUAD_SIZE] : [15, 20, 25]).map((val) => (
            <button
              key={val}
              className={`option-btn-vert ${form.squad_size === val ? 'active' : ''}`}
              onClick={() => setForm((p) => ({ ...p, squad_size: val }))}
              type="button"
            >
              {val}
            </button>
          ))}
        </div>
      </div>

      {isMatchAuction ? (
        <div className="setting-group">
          <div className="setting-label">Match Auction Rules</div>
          <div className="card" style={{ padding: 14 }}>
            <p className="text-secondary text-sm">Timer is locked to {MATCH_ROOM_TIMER_SECONDS}s. Min/Max participants are locked to 2. Minimum squad size is {MATCH_ROOM_MINIMUM_SQUAD_SIZE}.</p>
          </div>
        </div>
      ) : isLegendsAuction ? (
        <div className="setting-group">
          <div className="setting-label">Legends Auction Rules</div>
          <div className="card" style={{ padding: 14 }}>
            <p className="text-secondary text-sm">
              Squad size is locked to {LEGENDS_ROOM_SQUAD_SIZE}. Min participants stay at {LEGENDS_ROOM_MINIMUM_PARTICIPANTS} and max participants stay at {LEGENDS_ROOM_PARTICIPANT_LIMIT}.
            </p>
          </div>
        </div>
      ) : (
        <div className="setting-group">
          <div className="setting-label">Timer Per Player</div>
          <div className="option-group-vert">
            {[5, 10, 15, 20].map((val) => (
              <button
                key={val}
                className={`option-btn-vert ${form.timer_seconds === val ? 'active' : ''}`}
                onClick={() => setForm((p) => ({ ...p, timer_seconds: val }))}
                type="button"
              >
                {val}s
              </button>
            ))}
          </div>
        </div>
      )}

      {!isMatchAuction && (
        <div className="setting-group" style={{ marginBottom: 0 }}>
          <div className="setting-label">Player Order</div>
          <div className="option-group-vert" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {(['category', 'random'] as const).map((val) => (
              <button
                key={val}
                className={`option-btn-vert ${form.player_order === val ? 'active' : ''}`}
                onClick={() => setForm((p) => ({ ...p, player_order: val }))}
                type="button"
              >
                {val === 'category' ? 'Category' : 'Random'}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={async () => {
          setSaving(true)
          setMessage(null)
          const nextSettings = isMatchAuction
            ? {
                ...form,
                timer_seconds: MATCH_ROOM_TIMER_SECONDS,
                player_order: 'random',
                min_participants: 2,
                max_participants: 2,
                minimum_squad_size: MATCH_ROOM_MINIMUM_SQUAD_SIZE
              }
            : isLegendsAuction
              ? {
                  ...form,
                  squad_size: LEGENDS_ROOM_SQUAD_SIZE,
                  min_participants: LEGENDS_ROOM_MINIMUM_PARTICIPANTS,
                  max_participants: LEGENDS_ROOM_PARTICIPANT_LIMIT
                }
            : form
          const { data, error } = await supabaseClient.rpc('update_room_settings', {
            p_room_id: roomId,
            p_settings: nextSettings,
            p_idempotency_key: createIdempotencyKey('room-settings', roomId)
          })
          if (error) setMessage(error.message)
          else if (data?.success === false) setMessage(data.error || 'Failed to save settings')
          else setMessage('Settings saved')
          setSaving(false)
        }}
        disabled={saving}
        className="btn btn-primary w-full mt-4"
        type="button"
      >
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
      {message && <p className="text-dim text-sm mt-2">{message}</p>}
    </div>
  )
}

export default AdminSettings

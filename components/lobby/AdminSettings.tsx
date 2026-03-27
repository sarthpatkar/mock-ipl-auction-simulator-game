'use client'

import { useEffect, useState } from 'react'
import { supabaseClient } from '@/lib/supabase'
import { RoomSettings } from '@/types'

type Props = {
  roomId: string
  settings: RoomSettings
}

export function AdminSettings({ roomId, settings }: Props) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setForm(settings)
  }, [settings])

  return (
    <div className="settings-card">
      <div className="settings-title">Room Settings</div>

      <div className="setting-group">
        <div className="setting-label">Team Budget</div>
        <div className="option-group-vert">
          {[100, 150, 200, 250].map((val) => (
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
          {[15, 20, 25].map((val) => (
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

      <button
        onClick={async () => {
          setSaving(true)
          setMessage(null)
          const { error } = await supabaseClient.from('rooms').update({ settings: form }).eq('id', roomId)
          if (error) setMessage(error.message)
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

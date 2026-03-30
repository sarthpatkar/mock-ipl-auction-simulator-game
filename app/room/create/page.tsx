'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { createRoomWithAdmin, DEFAULT_ROOM_SETTINGS } from '@/lib/room-client'

export default function CreateRoomPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [teamName, setTeamName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await createRoomWithAdmin(name, teamName, DEFAULT_ROOM_SETTINGS)
      router.push(`/room/${result.room_id}/lobby`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create room')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="screen page-with-navbar form-page">
      <PageNavbar subtitle="CREATE ROOM" showHome />
      <main className="themed-form-page">
        <div className="themed-form-shell">
          <h1 className="themed-form-title">Create Room</h1>
          <form onSubmit={handleCreate} className="card themed-form-card">
            <label className="input-group">
              <span className="input-label">Room name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="input-field"
            />
          </label>
            <label className="input-group">
              <span className="input-label">Your team name</span>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              required
              className="input-field"
            />
          </label>
            {error && <p className="text-red text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
              className="btn btn-primary btn-lg w-full"
          >
            {loading ? 'Creating…' : 'Create Room'}
          </button>
          </form>
        </div>
      </main>
    </div>
  )
}

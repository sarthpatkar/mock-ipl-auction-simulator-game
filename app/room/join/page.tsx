'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { getBrowserSessionUser, supabaseClient } from '@/lib/supabase'

export default function JoinRoomPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [teamName, setTeamName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const user = await getBrowserSessionUser()
    if (!user) {
      setError('You must be logged in')
      return
    }

    const { data, error: joinError } = await supabaseClient.rpc('join_room_by_code', {
      p_code: code,
      p_team_name: teamName.trim() || 'Guest'
    })

    if (joinError) {
      setError(joinError.message)
      return
    }

    if (!data?.success) {
      setError(data?.error || 'Room not found')
      return
    }

    router.push(`/room/${data.room_id}/lobby`)
  }

  return (
    <div className="screen page-with-navbar form-page">
      <PageNavbar subtitle="JOIN ROOM" showHome />
      <main className="themed-form-page">
        <div className="themed-form-shell">
          <h1 className="themed-form-title">Join Room</h1>
          <form onSubmit={handleJoin} className="card themed-form-card">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter 7-digit code"
              className="input-field"
            required
          />
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
              className="input-field"
            required
          />
            {error && <p className="text-red text-sm">{error}</p>}
          <button
            type="submit"
              className="btn btn-primary btn-lg w-full"
          >
            Join
          </button>
          </form>
        </div>
      </main>
    </div>
  )
}

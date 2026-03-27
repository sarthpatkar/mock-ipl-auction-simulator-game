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
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-16">
        <h1 className="text-3xl font-bold">Join Room</h1>
        <form onSubmit={handleJoin} className="glass rounded-2xl p-6 space-y-4">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter 7-digit code"
            className="w-full rounded-lg bg-slate-900/60 p-3 ring-1 ring-slate-800 focus:ring-amber-400"
            required
          />
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
            className="w-full rounded-lg bg-slate-900/60 p-3 ring-1 ring-slate-800 focus:ring-amber-400"
            required
          />
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-amber-400 px-4 py-3 font-semibold text-slate-900 hover:bg-amber-300"
          >
            Join
          </button>
        </form>
      </main>
    </div>
  )
}

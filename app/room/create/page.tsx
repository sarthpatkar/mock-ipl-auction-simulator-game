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
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-16">
        <h1 className="text-3xl font-bold">Create Room</h1>
        <form onSubmit={handleCreate} className="glass rounded-2xl p-6 space-y-4">
          <label className="space-y-2 text-sm">
            <span>Room name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg bg-slate-900/60 p-3 ring-1 ring-slate-800 focus:ring-amber-400"
            />
          </label>
          <label className="space-y-2 text-sm">
            <span>Your team name</span>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              required
              className="w-full rounded-lg bg-slate-900/60 p-3 ring-1 ring-slate-800 focus:ring-amber-400"
            />
          </label>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-amber-400 px-4 py-3 font-semibold text-slate-900 hover:bg-amber-300 disabled:opacity-60"
          >
            {loading ? 'Creating…' : 'Create Room'}
          </button>
        </form>
      </main>
    </div>
  )
}

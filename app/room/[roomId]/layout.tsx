import { ReactNode } from 'react'
import { RoomSoundtrackController } from '@/components/room/RoomSoundtrackController'

type Props = {
  children: ReactNode
  params: Promise<{
    roomId: string
  }>
}

export default async function RoomLayout({ children, params }: Props) {
  const { roomId } = await params

  return (
    <>
      <RoomSoundtrackController roomId={roomId} />
      {children}
    </>
  )
}

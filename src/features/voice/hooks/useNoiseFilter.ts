import { useEffect } from 'react'
import type { Room } from 'livekit-client'
import { watchNoiseFilter } from '../../../lib/noiseFilter'
import { useNoiseFilterStore } from '../../../stores/noiseFilterStore'

export function useNoiseFilter(room: Room | null) {
  useEffect(() => {
    if (!room) return
    const dispose = watchNoiseFilter(room, (state) => useNoiseFilterStore.setState(state))
    return () => {
      dispose()
      useNoiseFilterStore.setState({ status: 'idle', error: null })
    }
  }, [room])
}

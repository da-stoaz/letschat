import { create } from 'zustand'
import type { Channel, u64 } from '../types/domain'

interface ChannelsState {
  channelsByServer: Record<u64, Channel[]>
  setServerChannels: (serverId: u64, channels: Channel[]) => void
  upsertChannel: (channel: Channel) => void
}

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channelsByServer: {},
  setServerChannels: (serverId, channels) =>
    set((state) => ({
      channelsByServer: { ...state.channelsByServer, [serverId]: channels },
    })),
  upsertChannel: (channel) => {
    const current = get().channelsByServer[channel.serverId] ?? []
    const idx = current.findIndex((c) => c.id === channel.id)
    const next = [...current]
    if (idx === -1) next.push(channel)
    else next[idx] = channel
    next.sort((a, b) => a.position - b.position)
    set((state) => ({
      channelsByServer: { ...state.channelsByServer, [channel.serverId]: next },
    }))
  },
}))

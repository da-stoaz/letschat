import { create } from 'zustand'
import type { Channel, u64 } from '../types/domain'

interface ChannelsState {
  channelsByServer: Record<u64, Channel[]>
  setServerChannels: (serverId: u64, channels: Channel[]) => void
  upsertChannel: (channel: Channel) => void
}

function channelSectionSortValue(section: string | null): string {
  return (section ?? '').trim().toLowerCase()
}

function compareChannelsByLayout(a: Channel, b: Channel): number {
  const sectionDelta = channelSectionSortValue(a.section).localeCompare(channelSectionSortValue(b.section))
  if (sectionDelta !== 0) return sectionDelta

  const positionDelta = a.position - b.position
  if (positionDelta !== 0) return positionDelta

  return a.id - b.id
}

function areChannelsEqual(a: Channel[], b: Channel[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (
      left.id !== right.id ||
      left.serverId !== right.serverId ||
      left.name !== right.name ||
      left.kind !== right.kind ||
      left.position !== right.position ||
      left.section !== right.section ||
      left.moderatorOnly !== right.moderatorOnly
    ) {
      return false
    }
  }
  return true
}

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channelsByServer: {},
  setServerChannels: (serverId, channels) =>
    set((state) => {
      const current = state.channelsByServer[serverId] ?? []
      if (areChannelsEqual(current, channels)) return state
      return {
        channelsByServer: { ...state.channelsByServer, [serverId]: channels },
      }
    }),
  upsertChannel: (channel) => {
    const current = get().channelsByServer[channel.serverId] ?? []
    const idx = current.findIndex((c) => c.id === channel.id)
    const next = [...current]
    if (idx === -1) {
      next.push(channel)
    } else {
      const currentRow = next[idx]
      if (
        currentRow.id === channel.id &&
        currentRow.serverId === channel.serverId &&
        currentRow.name === channel.name &&
        currentRow.kind === channel.kind &&
        currentRow.position === channel.position &&
        currentRow.section === channel.section &&
        currentRow.moderatorOnly === channel.moderatorOnly
      ) {
        return
      }
      next[idx] = channel
    }
    next.sort(compareChannelsByLayout)

    if (areChannelsEqual(current, next)) return

    set((state) => ({
      channelsByServer: { ...state.channelsByServer, [channel.serverId]: next },
    }))
  },
}))

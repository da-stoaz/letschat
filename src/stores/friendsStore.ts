import { create } from 'zustand'
import type { Block, Friend } from '../types/domain'

interface FriendsState {
  friends: Friend[]
  blocked: Block[]
  setFriends: (friends: Friend[]) => void
  setBlocked: (blocked: Block[]) => void
}

export const useFriendsStore = create<FriendsState>((set) => ({
  friends: [],
  blocked: [],
  setFriends: (friends) => set({ friends }),
  setBlocked: (blocked) => set({ blocked }),
}))

import { create } from 'zustand'
import type { Identity } from '../types/domain'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

interface ConnectionState {
  status: ConnectionStatus
  identity: Identity | null
  setStatus: (status: ConnectionStatus) => void
  setIdentity: (identity: Identity | null) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',
  identity: null,
  setStatus: (status) => set({ status }),
  setIdentity: (identity) => set({ identity }),
}))

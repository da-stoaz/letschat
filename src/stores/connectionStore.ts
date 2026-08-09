import { create } from 'zustand'
import type { Identity } from '../types/domain'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

interface ConnectionState {
  status: ConnectionStatus
  /** Human-readable failure detail, set alongside the 'error' status. */
  errorMessage: string | null
  identity: Identity | null
  setStatus: (status: ConnectionStatus, errorMessage?: string | null) => void
  setIdentity: (identity: Identity | null) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',
  errorMessage: null,
  identity: null,
  setStatus: (status, errorMessage = null) => set({ status, errorMessage }),
  setIdentity: (identity) => set({ identity }),
}))

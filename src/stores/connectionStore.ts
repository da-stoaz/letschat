import { create } from 'zustand'
import type { Identity } from '../types/domain'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

interface ConnectionState {
  status: ConnectionStatus
  /** Human-readable failure detail, set alongside the 'error' status. */
  errorMessage: string | null
  identity: Identity | null
  /**
   * True once the initial subscription has been applied and the stores
   * reflect the server. Until then an empty `servers` list means "not loaded
   * yet", not "the user is in no spaces".
   */
  synced: boolean
  setStatus: (status: ConnectionStatus, errorMessage?: string | null) => void
  setIdentity: (identity: Identity | null) => void
  setSynced: (synced: boolean) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',
  errorMessage: null,
  identity: null,
  synced: false,
  setStatus: (status, errorMessage = null) => set({ status, errorMessage }),
  setIdentity: (identity) => set({ identity }),
  setSynced: (synced) => set({ synced }),
}))

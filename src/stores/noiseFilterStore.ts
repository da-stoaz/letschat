import { create } from 'zustand'

// Runtime state only: a saved preference is not proof that audio is filtered.
export const useNoiseFilterStore = create<{
  status: 'idle' | 'loading' | 'active' | 'off' | 'error'
  error: string | null
}>(() => ({ status: 'idle', error: null }))

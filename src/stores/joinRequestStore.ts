import { create } from 'zustand'
import type { JoinRequest, User } from '../types/domain'

export interface JoinRequestWithUser extends JoinRequest {
  user: User | null
}

interface JoinRequestState {
  /** Server ids the current user has a pending request for (requester view). */
  myPendingServerIds: number[]
  /** Pending requests (with requester profile) grouped by spaces the user moderates. */
  requestsByServer: Record<number, JoinRequestWithUser[]>
  setRequests: (mine: number[], byServer: Record<number, JoinRequestWithUser[]>) => void
}

export const useJoinRequestStore = create<JoinRequestState>((set) => ({
  myPendingServerIds: [],
  requestsByServer: {},
  setRequests: (myPendingServerIds, requestsByServer) =>
    set({ myPendingServerIds, requestsByServer }),
}))

import { create } from 'zustand'
import type { JoinRequest, JoinRequestStatus, User } from '../types/domain'

export interface JoinRequestWithUser extends JoinRequest {
  user: User | null
}

interface JoinRequestState {
  /** The current user's own requests, by server id → status (requester view). */
  myStatusByServer: Record<number, JoinRequestStatus>
  /** Pending (not declined) requests with profile, for spaces the user moderates. */
  requestsByServer: Record<number, JoinRequestWithUser[]>
  setRequests: (
    mine: Record<number, JoinRequestStatus>,
    byServer: Record<number, JoinRequestWithUser[]>,
  ) => void
}

export const useJoinRequestStore = create<JoinRequestState>((set) => ({
  myStatusByServer: {},
  requestsByServer: {},
  setRequests: (myStatusByServer, requestsByServer) => set({ myStatusByServer, requestsByServer }),
}))

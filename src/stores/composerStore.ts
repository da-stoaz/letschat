import { create } from 'zustand'
import type { ChatMessageAttachment } from '../types/attachments'

export type UploadStage = 'requesting' | 'uploading' | 'confirming' | 'done' | 'failed'
export type QueuedFile = { id: string; file: File; attachment?: ChatMessageAttachment }
export type ComposerDraft = {
  text: string
  files: QueuedFile[]
  stages: Record<string, UploadStage>
  progress: Record<string, number>
  error: string | null
  submitting: boolean
  operation: number
  sent: number
}
export const EMPTY_DRAFT: ComposerDraft = {
  text: '', files: [], stages: {}, progress: {}, error: null, submitting: false, operation: 0, sent: 0,
}
let nextOperation = 0

export const useComposerStore = create<{
  drafts: Record<string, ComposerDraft>
  update: (scope: string, patch: Partial<ComposerDraft>, operation?: number) => void
  beginSend: (scope: string) => ComposerDraft | null
  reset: () => void
}>((set, get) => ({
  drafts: {},
  update: (scope, patch, operation) => set(state => {
    const draft = state.drafts[scope] ?? EMPTY_DRAFT
    // A completed task from a cleared session must not recreate its draft.
    if (operation !== undefined && draft.operation !== operation) return state
    return { drafts: { ...state.drafts, [scope]: { ...draft, ...patch } } }
  }),
  beginSend: scope => {
    const draft = get().drafts[scope] ?? EMPTY_DRAFT
    if (draft.submitting || (!draft.text.trim() && !draft.files.length)) return null
    const sending = { ...draft, submitting: true, error: null, operation: ++nextOperation }
    set(state => ({ drafts: { ...state.drafts, [scope]: sending } }))
    return sending
  },
  reset: () => set({ drafts: {} }),
}))

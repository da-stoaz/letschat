import { create } from 'zustand'
import type { ChatMessageAttachment } from '../types/attachments'

export type UploadStage = 'requesting' | 'uploading' | 'confirming' | 'done' | 'failed'
export type QueuedFile = { id: string; file: File; attachment?: ChatMessageAttachment }
export type OutgoingMessage = {
  text: string
  files: QueuedFile[]
  stages: Record<string, UploadStage>
  progress: Record<string, number>
  error: string | null
}
export type ComposerDraft = {
  outgoing: OutgoingMessage | null
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
  outgoing: null, text: '', files: [], stages: {}, progress: {}, error: null, submitting: false, operation: 0, sent: 0,
}
let nextOperation = 0

export const useComposerStore = create<{
  drafts: Record<string, ComposerDraft>
  update: (scope: string, patch: Partial<ComposerDraft>, operation?: number) => void
  beginSend: (scope: string, retry?: boolean) => ComposerDraft | null
  reset: () => void
}>((set, get) => ({
  drafts: {},
  update: (scope, patch, operation) => set(state => {
    const draft = state.drafts[scope] ?? EMPTY_DRAFT
    // A completed task from a cleared session must not recreate its draft.
    if (operation !== undefined && draft.operation !== operation) return state
    return { drafts: { ...state.drafts, [scope]: { ...draft, ...patch } } }
  }),
  beginSend: (scope, retry = false) => {
    const draft = get().drafts[scope] ?? EMPTY_DRAFT
    if (draft.submitting || (draft.outgoing && !retry)) return null
    const content = retry ? draft.outgoing : draft
    if (!content || (!content.text.trim() && !content.files.length)) return null
    const outgoing = { text: content.text, files: content.files, stages: content.stages, progress: content.progress, error: null }
    const sending = { ...draft, ...(retry ? {} : { text: '', files: [], stages: {}, progress: {} }), outgoing, submitting: true, error: null, operation: ++nextOperation }
    set(state => ({ drafts: { ...state.drafts, [scope]: sending } }))
    return { ...sending, ...outgoing }
  },
  reset: () => set({ drafts: {} }),
}))

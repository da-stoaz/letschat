import { useComposerStore } from '../../stores/composerStore'
import { uploadFiles, type UploadScope } from '../../lib/uploads'
import type { ChatMessageAttachment } from '../../types/attachments'

export type ChatComposerSubmitPayload = { text: string; attachments: ChatMessageAttachment[] }

export async function submitComposer(
  scopeKey: string,
  uploadScope: UploadScope,
  onSubmit: (payload: ChatComposerSubmitPayload) => Promise<void> | void,
) {
  const store = useComposerStore.getState()
  const draft = store.beginSend(scopeKey)
  if (!draft) return
  const { operation } = draft
  const isCurrent = () => useComposerStore.getState().drafts[scopeKey]?.operation === operation
  const update = (patch: Parameters<typeof store.update>[1]) => store.update(scopeKey, patch, operation)
  const files = [...draft.files]
  try {
    for (let index = 0; index < files.length; index++) {
      if (!isCurrent()) return
      const entry = files[index]
      if (entry.attachment) continue
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- Persist each completed upload before starting the next; retries keep earlier attachments and stop on failure.
      const [attachment] = await uploadFiles([entry.file], uploadScope, (_file, stage) => {
        const stages = useComposerStore.getState().drafts[scopeKey]?.stages ?? {}
        update({ stages: { ...stages, [entry.id]: stage } })
      }, (_file, progress) => {
        const current = useComposerStore.getState().drafts[scopeKey]?.progress ?? {}
        update({ progress: { ...current, [entry.id]: progress.fraction } })
      })
      files[index] = { ...entry, attachment }
      update({ files: [...files] })
    }
    if (!isCurrent()) return
    await onSubmit({ text: draft.text.trim(), attachments: files.map(entry => entry.attachment!) })
    update({ text: '', files: [], stages: {}, progress: {}, error: null, sent: draft.sent + 1 })
  } catch (error) {
    update({ error: error instanceof Error ? error.message : 'Could not send message.' })
  } finally {
    update({ submitting: false })
  }
}

export function shouldSubmitOnEnter(key: string, shift: boolean, composing: boolean, touch: boolean) {
  return key === 'Enter' && !shift && !composing && !touch
}

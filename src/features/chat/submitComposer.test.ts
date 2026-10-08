import { beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_DRAFT, useComposerStore } from '../../stores/composerStore'
import { shouldSubmitOnEnter, submitComposer } from './submitComposer'
import { uploadFiles } from '../../lib/uploads'

vi.mock('../../lib/uploads', () => ({ uploadFiles: vi.fn() }))
const uploaded = { storageKey: 'test/photo', fileName: 'photo.jpg', fileSize: 4, mimeType: 'image/jpeg' }
beforeEach(() => { useComposerStore.getState().reset(); vi.clearAllMocks() })

it('isolates drafts and captures the original conversation during a send', async () => {
  const store = useComposerStore.getState()
  store.update('channel:1', { text: 'First' })
  store.update('dm:other', { text: 'Second' })
  let finish!: () => void
  const send = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = submitComposer('channel:1', { kind: 'channel', channelId: 1 }, send)
  expect(send).toHaveBeenCalledWith({ text: 'First', attachments: [] })
  expect(useComposerStore.getState().drafts['channel:1'].submitting).toBe(true)
  await submitComposer('channel:1', { kind: 'channel', channelId: 1 }, send)
  expect(send).toHaveBeenCalledTimes(1)
  store.update('dm:other', { text: 'Unrelated draft' })
  finish()
  await pending
  expect(useComposerStore.getState().drafts['channel:1'].text).toBe('')
  expect(useComposerStore.getState().drafts['dm:other'].text).toBe('Unrelated draft')
})

it('retains completed uploads and text on failure, and retries without uploading again', async () => {
  const file = new File(['test'], 'photo.jpg', { type: 'image/jpeg' })
  useComposerStore.getState().update('channel:1', { text: 'Photo', files: [{ id: 'photo', file }] })
  vi.mocked(uploadFiles).mockResolvedValue([uploaded])
  const send = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(undefined)
  await submitComposer('channel:1', { kind: 'channel', channelId: 1 }, send)
  const draft = useComposerStore.getState().drafts['channel:1']
  expect(draft.text).toBe('Photo')
  expect(draft.files[0].file).toBe(file)
  expect(draft.files[0].attachment).toEqual(uploaded)
  expect(draft.error).toBe('Offline')
  expect(draft.submitting).toBe(false)
  await submitComposer('channel:1', { kind: 'channel', channelId: 1 }, send)
  expect(uploadFiles).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenLastCalledWith({ text: 'Photo', attachments: [uploaded] })
  expect(useComposerStore.getState().drafts['channel:1'].files).toEqual([])
})

it('retains earlier attachments when a later upload fails', async () => {
  const file = new File(['a'], 'a.jpg')
  const second = new File(['b'], 'b.jpg')
  useComposerStore.getState().update('dm:other', { files: [{ id: 'a', file }, { id: 'b', file: second }] })
  vi.mocked(uploadFiles).mockResolvedValueOnce([uploaded]).mockRejectedValueOnce(new Error('Upload failed'))
  const send = vi.fn()
  await submitComposer('dm:other', { kind: 'dm', partner: 'other' }, send)
  expect(send).not.toHaveBeenCalled()
  expect(useComposerStore.getState().drafts['dm:other'].files[0].attachment).toEqual(uploaded)
  expect(useComposerStore.getState().drafts['dm:other'].files[1].file).toBe(second)
})

it('does not send or restore drafts when the session is cleared during an upload', async () => {
  const file = new File(['a'], 'a.jpg')
  useComposerStore.getState().update('channel:1', { files: [{ id: 'a', file }] })
  let finish!: (value: typeof uploaded[]) => void
  vi.mocked(uploadFiles).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const send = vi.fn()
  const pending = submitComposer('channel:1', { kind: 'channel', channelId: 1 }, send)
  useComposerStore.getState().reset()
  useComposerStore.getState().update('channel:1', { text: 'New session' })
  finish([uploaded])
  await pending
  expect(send).not.toHaveBeenCalled()
  expect(useComposerStore.getState().drafts['channel:1']).toEqual({ ...EMPTY_DRAFT, text: 'New session' })
})

it('uses explicit submission for touch and ignores composition and shifted Enter', () => {
  expect(shouldSubmitOnEnter('Enter', false, false, false)).toBe(true)
  expect(shouldSubmitOnEnter('Enter', false, false, true)).toBe(false)
  expect(shouldSubmitOnEnter('Enter', false, true, false)).toBe(false)
  expect(shouldSubmitOnEnter('Enter', true, false, false)).toBe(false)
})

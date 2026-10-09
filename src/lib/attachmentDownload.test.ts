import { afterEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { downloadAttachment } from './attachmentDownload'

vi.mock('./tauri', () => ({ isDesktopTauriRuntime: () => false }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('reports a failed file by name while allowing the caller to reset and retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
  await expect(downloadAttachment({ url: '/file', fileName: 'photo.jpg' })).rejects.toThrow('503')
  expect(toast.error).toHaveBeenCalledWith('Could not save photo.jpg', expect.any(Object))
})

it('does not present intentional cancellation as a download failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')))
  await downloadAttachment({ url: '/file', fileName: 'photo.jpg' })
  expect(toast.error).not.toHaveBeenCalled()
})

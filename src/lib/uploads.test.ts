import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authServiceUploadAbort, authServiceUploadConfirm, authServiceUploadPartUrl,
  authServiceUploadRequest, authServiceUploadStatus,
} from './authService'
import { cancelUpload, uploadFiles, uploadSingleFile } from './uploads'

vi.mock('./authService', () => ({
  authServiceUploadRequest: vi.fn(),
  authServiceUploadConfirm: vi.fn(),
  authServiceUploadPartUrl: vi.fn(),
  authServiceUploadStatus: vi.fn(),
  authServiceUploadAbort: vi.fn(),
}))
vi.mock('./uploadSession', () => ({ withSessionTokenRetry: (fn: (token: object) => unknown) => fn({}) }))

class FakeXHR {
  static sent: Array<{ url: string; size: number }> = []
  static failures = 0
  static storageFull = false
  upload: { onprogress?: (event: { lengthComputable: boolean; total: number; loaded: number }) => void } = {}
  onload?: () => void
  onerror?: () => void
  onabort?: () => void
  status = 0
  responseText = ''
  private url = ''

  open(_method: string, url: string): void { this.url = url }
  setRequestHeader(): void {}
  set responseType(_value: string) {}
  send(body: Blob): void {
    FakeXHR.sent.push({ url: this.url, size: body.size })
    if (FakeXHR.storageFull) {
      this.status = 507
      this.responseText = '<Error><Code>XMinioStorageFull</Code></Error>'
      this.onload?.()
      return
    }
    if (this.url.endsWith('part=2') && FakeXHR.failures++ < 3) {
      this.status = 503
      this.onload?.()
      return
    }
    this.status = 200
    this.upload.onprogress?.({ lengthComputable: true, loaded: body.size, total: body.size })
    this.onload?.()
  }
}

describe('multipart upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeXHR.sent = []
    FakeXHR.failures = 0
    FakeXHR.storageFull = false
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
  })

  it('reuses the same session and uploads only missing parts after a failed attempt', async () => {
    vi.mocked(authServiceUploadRequest).mockResolvedValue({
      uploadId: 'upload-1', uploadUrl: null, expiresIn: 7200,
      mode: 'multipart', partSizeBytes: 5, partCount: 3,
    })
    vi.mocked(authServiceUploadStatus)
      .mockResolvedValueOnce({ completedParts: [1] })
      .mockResolvedValueOnce({ completedParts: [1, 2] })
    vi.mocked(authServiceUploadPartUrl).mockImplementation(async ({ partNumber }) => ({
      url: `https://storage.test/part=${partNumber}`, expiresIn: 600,
    }))
    vi.mocked(authServiceUploadConfirm).mockResolvedValue({
      storageKey: 'uploads/ch/1/me/test.bin', fileName: 'test.bin',
      fileSize: 11, mimeType: 'application/octet-stream',
    })
    const file = new File(['hello world'], 'test.bin', { type: 'application/octet-stream' })
    const scope = { kind: 'channel' as const, channelId: 1 }

    await expect(uploadSingleFile(file, scope)).rejects.toThrow('Storage upload failed (503)')
    expect(FakeXHR.sent).toEqual([
      { url: 'https://storage.test/part=2', size: 5 },
      { url: 'https://storage.test/part=2', size: 5 },
      { url: 'https://storage.test/part=2', size: 5 },
    ])

    await expect(uploadSingleFile(file, scope)).resolves.toMatchObject({ fileSize: 11 })
    expect(authServiceUploadRequest).toHaveBeenCalledTimes(1)
    expect(FakeXHR.sent.at(-1)).toEqual({ url: 'https://storage.test/part=3', size: 1 })
    expect(authServiceUploadConfirm).toHaveBeenCalledTimes(1)
  })

  it('aborts a failed multipart session when the file is removed', async () => {
    vi.mocked(authServiceUploadRequest).mockResolvedValue({
      uploadId: 'upload-2', uploadUrl: null, expiresIn: 7200,
      mode: 'multipart', partSizeBytes: 5, partCount: 2,
    })
    vi.mocked(authServiceUploadStatus).mockRejectedValue(new Error('offline'))
    vi.mocked(authServiceUploadAbort).mockResolvedValue()
    const file = new File(['123456'], 'cancel.bin')
    await expect(uploadSingleFile(file, { kind: 'channel', channelId: 1 })).rejects.toThrow('offline')
    await cancelUpload(file)
    expect(authServiceUploadAbort).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'upload-2' }))
  })

  it('marks a rejected upload request as failed', async () => {
    vi.mocked(authServiceUploadRequest).mockRejectedValue(new Error('Daily upload quota exceeded.'))
    const file = new File(['data'], 'test.bin')
    const onStage = vi.fn()

    await expect(uploadFiles([file], { kind: 'channel', channelId: 1 }, onStage))
      .rejects.toThrow('test.bin: Daily upload quota exceeded.')
    expect(onStage.mock.calls.map(([, stage]) => stage)).toEqual(['requesting', 'failed'])
  })

  it('reports a full MinIO volume and promptly releases a failed single-PUT reservation', async () => {
    FakeXHR.storageFull = true
    vi.mocked(authServiceUploadRequest).mockResolvedValue({
      uploadId: 'upload-full', uploadUrl: 'https://storage.test/upload', expiresIn: 600,
      mode: 'single', partSizeBytes: null, partCount: null,
    })
    vi.mocked(authServiceUploadAbort).mockResolvedValue()
    const file = new File(['data'], 'test.bin')

    await expect(uploadSingleFile(file, { kind: 'channel', channelId: 1 }))
      .rejects.toThrow('Object storage is full')
    expect(authServiceUploadAbort).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: 'upload-full' }),
    )
    expect(authServiceUploadConfirm).not.toHaveBeenCalled()
  })

  it('does not retry a multipart part when MinIO reports a full volume', async () => {
    FakeXHR.storageFull = true
    vi.mocked(authServiceUploadRequest).mockResolvedValue({
      uploadId: 'multipart-full', uploadUrl: null, expiresIn: 7200,
      mode: 'multipart', partSizeBytes: 5, partCount: 2,
    })
    vi.mocked(authServiceUploadStatus).mockResolvedValue({ completedParts: [] })
    vi.mocked(authServiceUploadPartUrl).mockResolvedValue({
      url: 'https://storage.test/part=1', expiresIn: 600,
    })

    await expect(uploadSingleFile(new File(['123456'], 'test.bin'),
      { kind: 'channel', channelId: 1 })).rejects.toThrow('Object storage is full')
    expect(FakeXHR.sent).toHaveLength(1)
    expect(authServiceUploadConfirm).not.toHaveBeenCalled()
  })
})
